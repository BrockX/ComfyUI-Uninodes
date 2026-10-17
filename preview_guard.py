"""Suppress intermediate tile/detailer websocket image previews for Image Finisher.

ComfyUI's nested samplers use ``ProgressBar.update_absolute`` with a
``preview`` argument.  That preview is assigned to the outer Finisher node,
which creates unwanted extra imagery below the Studio widget.

Only omit the intermediate preview payload while executing this node; regular
progress updates still flow.  The wrapper is installed once and guarded with
thread-local scope state so other nodes keep their normal preview behavior.
"""
from __future__ import annotations

from contextlib import contextmanager
from functools import wraps
import threading

_scope = threading.local()
_install_lock = threading.Lock()


def _install_guard():
    import comfy.utils

    progress_bar = comfy.utils.ProgressBar
    with _install_lock:
        original = progress_bar.update_absolute
        if getattr(original, "_uninodes_preview_filter", False):
            return

        @wraps(original)
        def update_without_finisher_previews(self, value, total=None, preview=None):
            if getattr(_scope, "active", 0):
                preview = None
            return original(self, value, total, preview)

        update_without_finisher_previews._uninodes_preview_filter = True
        progress_bar.update_absolute = update_without_finisher_previews


@contextmanager
def suppress_intermediate_previews():
    """Keep progress, but prevent nested sampler images appearing under Finisher."""
    _install_guard()
    _scope.active = getattr(_scope, "active", 0) + 1
    try:
        yield
    finally:
        _scope.active -= 1
