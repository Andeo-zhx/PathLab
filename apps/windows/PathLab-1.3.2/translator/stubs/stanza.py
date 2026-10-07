"""Minimal import shim for Argos' unused Stanza sentence-splitter path.

PathLab pins Argos to MiniSBD. This module exists only because Argos imports
the optional Stanza package at module import time even when Stanza is disabled.
"""


class Pipeline:
    def __init__(self, *args, **kwargs):
        raise RuntimeError("Stanza is disabled; Argos must use MiniSBD.")
