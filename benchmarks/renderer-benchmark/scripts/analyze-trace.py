#!/usr/bin/env python3
"""Attribute a Perfetto trace: per-thread CPU time and the main thread's slices.

Usage: analyze-trace.py <trace.pftrace> [--process=com.rendererbenchmark]
"""
import sys

from perfetto.trace_processor import TraceProcessor

path = [a for a in sys.argv[1:] if not a.startswith('--')][0]
process = next(
    (a.split('=')[1] for a in sys.argv[1:] if a.startswith('--process=')),
    'rendererbenchmark',
)

tp = TraceProcessor(trace=path)


def q(sql):
    return list(tp.query(sql))


window = q('select min(ts) as a, max(ts + dur) as b from sched')[0]
seconds = (window.b - window.a) / 1e9
print(f'trace window {seconds:.2f}s  process {process}\n')

print('per-thread CPU (ms, % of one core)')
rows = q(f"""
  select t.name as thread, sum(s.dur) / 1e6 as cpu_ms
  from sched s
  join thread t using(utid)
  join process p using(upid)
  where p.name like '%{process}%' and t.name is not null
  group by t.name order by cpu_ms desc limit 12
""")
for row in rows:
    print(f'  {row.thread:<28} {row.cpu_ms:9.1f}  {100 * row.cpu_ms / (seconds * 1000):6.1f}%')

total = sum(row.cpu_ms for row in rows)
print(f'  {"TOTAL":<28} {total:9.1f}  {100 * total / (seconds * 1000):6.1f}%\n')

for thread_name, title in (
    ('rendererbenchma', 'main thread'),
    ('mqt_js', 'JS thread'),
    ('TgfxRender', 'tgfx render thread'),
    ('RenderThread', 'HWUI RenderThread'),
    ('GLThread', 'Thor GL thread'),
):
    slices = q(f"""
      select s.name, count(*) as n, sum(s.dur) / 1e6 as ms
      from slice s
      join thread_track tt on s.track_id = tt.id
      join thread t using(utid)
      join process p using(upid)
      where p.name like '%{process}%' and t.name like '{thread_name}%'
      group by s.name order by ms desc limit 8
    """)
    if not slices:
        continue
    print(f'{title} ({thread_name}) top slices')
    for row in slices:
        print(f'  {row.name[:44]:<46} {row.n:6d} x  {row.ms:9.1f} ms')
    print()

tp.close()
