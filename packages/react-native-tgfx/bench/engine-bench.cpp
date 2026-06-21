// Native engine micro-benchmark + performance regression gate.
//
// Isolates the per-frame CPU work the engine does, comparing:
//   OLD  = parse the scene JSON and walk it EVERY frame (pre-refactor hot path)
//   NEW  = compile the scene ONCE, then per-frame just resolve animated value
//          slots over a flat command list (the current engine)
//
// Both paths do identical logical work (same field reads + transform math); the
// only difference is JSON parse + map lookups vs precompiled struct access — so
// the ratio measures exactly the compile-once optimization. The GPU draw is the
// same for both, so it is intentionally excluded.
//
// 100 measured rounds x 500 frames per scene, with mean/median/p95/p99/stddev.
// Exits non-zero if NEW per-frame time or the speedup regresses past the gates.
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

using json = nlohmann::json;
using clk = std::chrono::high_resolution_clock;
static volatile double g_sink = 0;

static std::string readFile(const std::string& p) {
  std::ifstream f(p);
  std::stringstream s;
  s << f.rdbuf();
  return s.str();
}

// ---------- OLD: parse + walk every frame ----------
static double slotO(const json& f, const std::vector<double>& v) {
  if (f.is_number()) return f.get<double>();
  if (f.is_object()) {
    auto it = f.find("__s");
    if (it != f.end() && it->is_number()) {
      int s = it->get<int>();
      if (s >= 0 && (size_t)s < v.size()) return v[s];
    }
  }
  return 0;
}
static double gO(const json& n, const char* k, const std::vector<double>& v) {
  auto it = n.find(k);
  return it != n.end() ? slotO(*it, v) : 0.0;
}
static double walkO(const json& n, const std::vector<double>& v) {
  auto t = n.find("t");
  if (t == n.end() || !t->is_string()) return 0;
  const std::string s = t->get<std::string>();
  double acc = 0;
  if (s == "g") {
    if (auto ops = n.find("ops"); ops != n.end() && ops->is_array()) {
      double a = 1, b = 0, c = 0, d = 1;
      for (auto& op : *ops) {
        double r = gO(op, "r", v);
        double cs = std::cos(r), sn = std::sin(r);
        a = a * cs - c * sn;
        b = b * cs - d * sn;
        acc += a + b + c + d + gO(op, "x", v) + gO(op, "y", v) + gO(op, "v", v);
      }
    } else if (auto m = n.find("m"); m != n.end() && m->is_array()) {
      for (auto& x : *m) acc += x.get<double>();
    }
    if (auto ch = n.find("ch"); ch != n.end() && ch->is_array())
      for (auto& c : *ch) acc += walkO(c, v);
    return acc;
  }
  if (auto p = n.find("p"); p != n.end()) {
    const json& pp = *p;
    if (auto c = pp.find("c"); c != pp.end() && c->is_number()) acc += c->get<double>();
    acc += gO(pp, "st", v) + gO(pp, "sw", v) + gO(pp, "cap", v) + gO(pp, "jn", v) + gO(pp, "a", v);
  }
  acc += gO(n, "x", v) + gO(n, "y", v) + gO(n, "w", v) + gO(n, "h", v) + gO(n, "cx", v) +
         gO(n, "cy", v) + gO(n, "r", v) + gO(n, "rx", v) + gO(n, "ry", v) + gO(n, "x1", v) +
         gO(n, "y1", v) + gO(n, "x2", v) + gO(n, "y2", v) + gO(n, "fs", v);
  return acc;
}
static double frameOld(const std::string& scene, const std::vector<double>& v) {
  json root = json::parse(scene);
  auto r = root.find("root");
  if (r == root.end()) return 0;
  double acc = 0;
  if (auto ch = r->find("ch"); ch != r->end() && ch->is_array())
    for (auto& c : *ch) acc += walkO(c, v);
  return acc;
}

// ---------- NEW: compile once, resolve flat structs per frame ----------
struct AF {
  double lit = 0;
  int slot = -1;
  inline double r(const std::vector<double>& v) const {
    return slot >= 0 && (size_t)slot < v.size() ? v[slot] : lit;
  }
};
static AF mkAF(const json& f) {
  AF a;
  if (f.is_number())
    a.lit = f.get<double>();
  else if (f.is_object()) {
    auto it = f.find("__s");
    if (it != f.end() && it->is_number()) a.slot = it->get<int>();
  }
  return a;
}
static AF gAF(const json& n, const char* k) {
  auto it = n.find(k);
  return it != n.end() ? mkAF(*it) : AF{};
}
struct Op {
  AF x, y, r, v;
};
struct Cmd {
  bool group = false;
  AF x, y, w, h, cx, cy, r, rx, ry, x1, y1, x2, y2, fs, st, sw, cap, jn, a;
  double color = 0;
  std::vector<Op> ops;
  std::vector<Cmd> ch;
};
static void compileC(const json& n, Cmd& cmd) {
  auto t = n.find("t");
  if (t == n.end() || !t->is_string()) return;
  const std::string s = t->get<std::string>();
  if (s == "g") {
    cmd.group = true;
    if (auto ops = n.find("ops"); ops != n.end() && ops->is_array())
      for (auto& op : *ops) {
        Op o;
        o.x = gAF(op, "x");
        o.y = gAF(op, "y");
        o.r = gAF(op, "r");
        o.v = gAF(op, "v");
        cmd.ops.push_back(o);
      }
    if (auto ch = n.find("ch"); ch != n.end() && ch->is_array())
      for (auto& c : *ch) {
        Cmd k;
        compileC(c, k);
        cmd.ch.push_back(std::move(k));
      }
    return;
  }
  if (auto p = n.find("p"); p != n.end()) {
    const json& pp = *p;
    if (auto c = pp.find("c"); c != pp.end() && c->is_number()) cmd.color = c->get<double>();
    cmd.st = gAF(pp, "st");
    cmd.sw = gAF(pp, "sw");
    cmd.cap = gAF(pp, "cap");
    cmd.jn = gAF(pp, "jn");
    cmd.a = gAF(pp, "a");
  }
  cmd.x = gAF(n, "x");
  cmd.y = gAF(n, "y");
  cmd.w = gAF(n, "w");
  cmd.h = gAF(n, "h");
  cmd.cx = gAF(n, "cx");
  cmd.cy = gAF(n, "cy");
  cmd.r = gAF(n, "r");
  cmd.rx = gAF(n, "rx");
  cmd.ry = gAF(n, "ry");
  cmd.x1 = gAF(n, "x1");
  cmd.y1 = gAF(n, "y1");
  cmd.x2 = gAF(n, "x2");
  cmd.y2 = gAF(n, "y2");
  cmd.fs = gAF(n, "fs");
}
static std::vector<Cmd> compileScene(const std::string& scene) {
  std::vector<Cmd> prog;
  json root = json::parse(scene);
  auto r = root.find("root");
  if (r == root.end()) return prog;
  if (auto ch = r->find("ch"); ch != r->end() && ch->is_array())
    for (auto& c : *ch) {
      Cmd k;
      compileC(c, k);
      prog.push_back(std::move(k));
    }
  return prog;
}
static double walkN(const Cmd& c, const std::vector<double>& v) {
  double acc = 0;
  if (c.group) {
    double a = 1, b = 0, cc = 0, d = 1;
    for (auto& op : c.ops) {
      double r = op.r.r(v), cs = std::cos(r), sn = std::sin(r);
      a = a * cs - cc * sn;
      b = b * cs - d * sn;
      acc += a + b + cc + d + op.x.r(v) + op.y.r(v) + op.v.r(v);
    }
    for (auto& k : c.ch) acc += walkN(k, v);
    return acc;
  }
  acc += c.color + c.st.r(v) + c.sw.r(v) + c.cap.r(v) + c.jn.r(v) + c.a.r(v);
  acc += c.x.r(v) + c.y.r(v) + c.w.r(v) + c.h.r(v) + c.cx.r(v) + c.cy.r(v) + c.r.r(v) +
         c.rx.r(v) + c.ry.r(v) + c.x1.r(v) + c.y1.r(v) + c.x2.r(v) + c.y2.r(v) + c.fs.r(v);
  return acc;
}
static double frameNew(const std::vector<Cmd>& prog, const std::vector<double>& v) {
  double acc = 0;
  for (auto& c : prog) acc += walkN(c, v);
  return acc;
}

// ---------- stats ----------
struct Stats {
  double mean, median, p95, p99, mn, mx, sd;
};
static Stats stat(std::vector<double> x) {
  std::sort(x.begin(), x.end());
  double s = 0;
  for (double v : x) s += v;
  double m = s / x.size();
  double var = 0;
  for (double v : x) var += (v - m) * (v - m);
  var /= x.size();
  auto pc = [&](double p) {
    return x[(size_t)std::min((double)x.size() - 1, p * (x.size() - 1))];
  };
  return Stats{m, pc(0.5), pc(0.95), pc(0.99), x.front(), x.back(), std::sqrt(var)};
}

static bool run(const char* name, const std::string& scene, int nValues,
                double maxNewUs, double minSpeedup) {
  std::vector<double> values(nValues, 1.0);
  auto prog = compileScene(scene);
  const int ROUNDS = 100, WARM = 10, FRAMES = 500;
  std::vector<double> oldNs, newNs;
  for (int round = 0; round < ROUNDS + WARM; round++) {
    auto t0 = clk::now();
    for (int f = 0; f < FRAMES; f++) {
      for (int i = 0; i < nValues; i++) values[i] = 1.0 + std::sin(f * 0.01 + i);
      g_sink += frameOld(scene, values);
    }
    auto t1 = clk::now();
    for (int f = 0; f < FRAMES; f++) {
      for (int i = 0; i < nValues; i++) values[i] = 1.0 + std::sin(f * 0.01 + i);
      g_sink += frameNew(prog, values);
    }
    auto t2 = clk::now();
    if (round >= WARM) {
      oldNs.push_back(std::chrono::duration<double, std::nano>(t1 - t0).count() / FRAMES);
      newNs.push_back(std::chrono::duration<double, std::nano>(t2 - t1).count() / FRAMES);
    }
  }
  Stats o = stat(oldNs), n = stat(newNs);
  double speedup = o.mean / n.mean;
  bool pass = (n.mean / 1e3 <= maxNewUs) && (speedup >= minSpeedup);
  printf("\n=== %s ===  (100 rounds x %d frames)\n", name, FRAMES);
  printf("  OLD  mean=%8.3f us  median=%8.3f  p95=%8.3f  p99=%8.3f  sd=%6.3f\n",
         o.mean / 1e3, o.median / 1e3, o.p95 / 1e3, o.p99 / 1e3, o.sd / 1e3);
  printf("  NEW  mean=%8.3f us  median=%8.3f  p95=%8.3f  p99=%8.3f  sd=%6.3f  CV=%.1f%%\n",
         n.mean / 1e3, n.median / 1e3, n.p95 / 1e3, n.p99 / 1e3, n.sd / 1e3, 100.0 * n.sd / n.mean);
  printf("  speedup mean=%.1fx median=%.1fx | gate: NEW<=%.1fus speedup>=%.0fx => %s\n",
         speedup, o.median / n.median, maxNewUs, minSpeedup, pass ? "PASS" : "FAIL");
  return pass;
}

int main(int argc, char** argv) {
  std::string dir = argc > 1 ? argv[1] : "scenes";
  printf("react-native-tgfx engine micro-benchmark + regression gate (-O2)\n");
  printf("per-frame CPU: OLD=parse+walk every frame  vs  NEW=compile once+resolve slots\n");
  bool ok = true;
  ok &= run("HEAVY (120-circle spiral)", readFile(dir + "/heavy.json"), 0, 5.0, 50.0);
  ok &= run("FULL (mixed ~30 nodes)", readFile(dir + "/full.json"), 0, 2.0, 30.0);
  ok &= run("ANIMATED (4 live slots)", readFile(dir + "/animated.json"), 4, 2.0, 30.0);
  printf("\n%s\n", ok ? "ALL GATES PASS" : "REGRESSION DETECTED");
  return ok ? 0 : 1;
}
