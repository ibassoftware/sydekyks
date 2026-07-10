"""pdfium (pypdfium2) is NOT thread-safe. Missions run concurrently on a threadpool / arq worker, so
two of them opening or rendering a PDF at the same time crashes the whole process with a native
"access violation reading 0xFFFF..." Serialize EVERY pdfium operation (open, page/text access,
render, close) through this single process-wide lock.

PDF text/raster work is fast (milliseconds), so serializing it barely dents throughput — the slow
part (the LLM call) stays fully concurrent because it happens outside the lock.
"""

import threading

# Reentrant so a single thread can nest pdfium calls (e.g. text extraction then image fallback).
PDFIUM_LOCK = threading.RLock()
