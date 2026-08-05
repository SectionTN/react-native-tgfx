// Scoped atrace markers, so the render thread is attributable in Perfetto. No-op off Android.
#pragma once

#if defined(__ANDROID__)
#include <android/trace.h>

namespace tgfxrn {
struct ScopedTrace {
  explicit ScopedTrace(const char* name) {
    ATrace_beginSection(name);
  }
  ~ScopedTrace() {
    ATrace_endSection();
  }
  ScopedTrace(const ScopedTrace&) = delete;
  ScopedTrace& operator=(const ScopedTrace&) = delete;
};
}  // namespace tgfxrn

#define TGFXRN_TRACE_CAT2(a, b) a##b
#define TGFXRN_TRACE_CAT(a, b) TGFXRN_TRACE_CAT2(a, b)
#define TGFXRN_TRACE(name) \
  ::tgfxrn::ScopedTrace TGFXRN_TRACE_CAT(tgfxrn_trace_, __LINE__)(name)
#else
#define TGFXRN_TRACE(name) ((void)0)
#endif
