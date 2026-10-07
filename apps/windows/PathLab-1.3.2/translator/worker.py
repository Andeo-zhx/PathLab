from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Argos imports its optional Stanza module even when the selected sentence
# splitter is MiniSBD. The packaged build includes a tiny shim, and this
# worker forces the MiniSBD path so the heavy Stanza/Torch stack is not needed.
os.environ["ARGOS_STANZA_AVAILABLE"] = "0"
os.environ["ARGOS_CHUNK_TYPE"] = "MINISBD"


def _languages():
    from argostranslate import translate

    return translate.get_installed_languages()


def _has_language_pair(source: str, target: str) -> bool:
    languages = _languages()
    source_language = next((item for item in languages if item.code == source), None)
    target_language = next((item for item in languages if item.code == target), None)
    return bool(source_language and target_language and source_language.get_translation(target_language))


def _handle(request: dict) -> dict:
    operation = request.get("op")
    source = request.get("sourceLanguage")
    target = request.get("targetLanguage")

    if operation == "has-model":
        return {"installed": _has_language_pair(source, target)}

    if operation == "install-model":
        model_path = Path(request.get("modelPath", ""))
        if not model_path.is_file() or model_path.suffix.lower() != ".argosmodel":
            raise ValueError("模型文件不存在或格式无效。")
        from argostranslate import package

        package.install_from_path(model_path)
        if not _has_language_pair(source, target):
            raise RuntimeError("模型安装完成，但没有找到对应的中英翻译方向。")
        return {"installed": True}

    if operation == "translate":
        text = request.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("待翻译文本为空。")
        languages = _languages()
        source_language = next((item for item in languages if item.code == source), None)
        target_language = next((item for item in languages if item.code == target), None)
        if source_language is None or target_language is None:
            raise RuntimeError("本地翻译模型尚未安装。")
        translation = source_language.get_translation(target_language)
        if translation is None:
            raise RuntimeError("本地翻译模型不支持该语言方向。")

        # Translate per line so annotation layout and intentional blank lines survive.
        output = []
        for line in text.splitlines(keepends=True):
            ending = "\r\n" if line.endswith("\r\n") else "\n" if line.endswith("\n") else "\r" if line.endswith("\r") else ""
            content = line[:-len(ending)] if ending else line
            output.append((translation.translate(content) if content.strip() else content) + ending)
        if not output and text:
            output = [translation.translate(text)]
        return {"text": "".join(output)}

    raise ValueError("不支持的翻译操作。")


def main() -> int:
    try:
        for stream in (sys.stdin, sys.stdout, sys.stderr):
            if hasattr(stream, "reconfigure"):
                stream.reconfigure(encoding="utf-8")
        request = json.load(sys.stdin)
        if not isinstance(request, dict):
            raise ValueError("翻译请求格式无效。")
        response = _handle(request)
        print(json.dumps({"ok": True, **response}, ensure_ascii=False))
        return 0
    except Exception as error:  # The parent process exposes a short, user-facing error.
        if os.environ.get("PATHLAB_TRANSLATION_DEBUG") == "1":
            import traceback

            traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
