import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Download, KeyRound, Languages, LoaderCircle, Sparkles, X } from 'lucide-react';
import { useProject } from '../store/projectStore';
import { useUi } from '../store/uiStore';
import type { TranslationLanguage } from '../lib/translation';

function guessSourceLanguage(text: string): TranslationLanguage {
  return /[\u3400-\u9fff]/.test(text) ? 'zh' : 'en';
}

export function TranslationDialog() {
  const annotationId = useUi((s) => s.translationAnnotationId);
  const closeDialog = useUi((s) => s.setTranslationAnnotation);
  const toast = useUi((s) => s.toast);
  const annotation = useProject((s) => s.project.annotations.find((a) => a.id === annotationId));
  const [sourceText] = useState(() => annotation?.text ?? '');
  const [translatedText, setTranslatedText] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [keyPanelOpen, setKeyPanelOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);

  const sourceLanguage = useMemo(() => guessSourceLanguage(sourceText), [sourceText]);
  const targetLanguage = sourceLanguage === 'zh' ? 'en' : 'zh';
  const sourceLabel = sourceLanguage === 'zh' ? '中文' : 'English';
  const targetLabel = targetLanguage === 'en' ? 'English' : '中文';

  const close = useCallback(() => {
    void window.pathlabTranslation?.invoke({ op: 'cancel' });
    closeDialog(null);
  }, [closeDialog]);

  const runTranslation = useCallback(async () => {
    const bridge = window.pathlabTranslation;
    if (!bridge) return;
    if (!sourceText.trim()) {
      setError('标注文字为空，无法翻译。');
      return;
    }
    setError('');
    setWorking(true);
    try {
      const result = await bridge.invoke({
        op: 'translate',
        text: sourceText,
        sourceLanguage,
        targetLanguage,
      });
      if (!result.ok) {
        if (result.code === 'missing-key') {
          setKeyConfigured(false);
          setKeyPanelOpen(true);
        }
        throw new Error(result.message);
      }
      if (result.cancelled) {
        setError('已取消操作。');
        return;
      }
      setTranslatedText(result.text ?? '');
      setKeyConfigured(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '翻译失败，请重试。');
    } finally {
      setWorking(false);
    }
  }, [sourceLanguage, sourceText, targetLanguage]);

  useEffect(() => {
    if (!annotationId) return;
    const bridge = window.pathlabTranslation;
    if (!bridge) return;
    let active = true;
    void bridge.invoke({ op: 'status' }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const configured = Boolean(result.keyConfigured);
      setKeyConfigured(configured);
      if (!configured) setKeyPanelOpen(true);
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : '无法检查 DeepSeek API Key。');
    });
    return () => {
      active = false;
      void bridge.invoke({ op: 'cancel' });
    };
  }, [annotationId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !working && !keyBusy) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, keyBusy, working]);

  if (!annotationId) return null;
  if (!annotation || annotation.type !== 'text') return null;

  const startTranslation = () => {
    if (!keyConfigured) {
      setKeyPanelOpen(true);
      setError('请先添加 DeepSeek API Key；请求翻译时，当前标注文字会发送至 DeepSeek。');
      return;
    }
    void runTranslation();
  };

  const saveKeyAndRetry = async () => {
    const bridge = window.pathlabTranslation;
    const value = apiKey.trim();
    if (!bridge || !value) {
      setError('请输入 DeepSeek API Key。');
      return;
    }
    setKeyBusy(true);
    setError('');
    try {
      const result = await bridge.invoke({ op: 'save-key', key: value });
      if (!result.ok) throw new Error(result.message);
      setApiKey('');
      setKeyConfigured(true);
      setKeyPanelOpen(false);
      await runTranslation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法保存 API Key。');
    } finally {
      setKeyBusy(false);
    }
  };

  const deleteKey = async () => {
    const bridge = window.pathlabTranslation;
    if (!bridge) return;
    setKeyBusy(true);
    try {
      const result = await bridge.invoke({ op: 'delete-key' });
      if (!result.ok) throw new Error(result.message);
      setKeyConfigured(false);
      setKeyPanelOpen(true);
      setApiKey('');
      setError('已删除本机保存的 DeepSeek API Key。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法删除 API Key。');
    } finally {
      setKeyBusy(false);
    }
  };

  const applyTranslation = () => {
    const translated = translatedText.trim();
    const current = useProject.getState().project.annotations.find((item) => item.id === annotationId);
    if (!current || !translated) {
      setError('请先获得或输入译文。');
      return;
    }
    const original = current.text ?? '';
    const nextText = `${original}${original.endsWith('\n') ? '' : '\n'}${translated}`;
    useProject.getState().applyWithHistory('添加双语标注', (draft) => {
      const target = draft.annotations.find((item) => item.id === annotationId);
      if (target) target.text = nextText;
    });
    close();
    toast('双语标注已写回，可撤销', 'success');
  };

  return (
    <div className="dialog-scrim" onMouseDown={(event) => event.target === event.currentTarget && !working && close()}>
      <div className="dialog translation-dialog" role="dialog" aria-modal="true" aria-label="翻译标注">
        <div className="dialog-head">
          <div className="translation-title-icon"><Languages size={18} /></div>
          <h2>翻译标注</h2>
          <span className="dh-sub">{sourceLabel} → {targetLabel}</span>
          <div style={{ flex: 1 }} />
          <button type="button" className="translation-close" aria-label="关闭翻译" onClick={close}>
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>

        <div className="dialog-body translation-body">
          <div className="field-group">
            <span className="field-label">原文</span>
            <div className="translation-source" aria-label="原文内容">{sourceText}</div>
          </div>

          <div className="field-group translation-result-group">
            <div className="translation-label-row">
              <span className="field-label">译文预览 · 可修改</span>
              <span className="translation-provider"><Sparkles size={13} /> DeepSeek</span>
            </div>
            <textarea
              className="translation-result"
              value={translatedText}
              onChange={(event) => setTranslatedText(event.target.value)}
              placeholder="点击下方按钮后显示译文，可直接修改。"
              spellCheck={false}
              disabled={working}
            />
          </div>

          {working && (
            <div className="translation-status" role="status" aria-live="polite">
              <LoaderCircle className="translation-spinner" size={16} />
              <span>正在请求 DeepSeek…</span>
            </div>
          )}

          {!window.pathlabTranslation && (
            <div className="translation-error" role="alert"><AlertCircle size={15} /> <span>翻译服务只在 PathLab 桌面版中可用。</span></div>
          )}

          {error && (
            <div className="translation-error" role="alert"><AlertCircle size={15} /> <span>{error}</span></div>
          )}

          <div className="translation-cloud-row">
            <button type="button" className="translation-cloud-button" onClick={startTranslation} disabled={working || keyBusy}>
              <Sparkles size={15} /> 发送至 DeepSeek 翻译
            </button>
            <span>点击后，当前标注原文会发送至 DeepSeek API。</span>
          </div>

          {keyConfigured && !keyPanelOpen && (
            <button type="button" className="translation-key-link" onClick={() => setKeyPanelOpen(true)}>
              <KeyRound size={14} /> 管理 DeepSeek API Key
            </button>
          )}

          {keyPanelOpen && (
            <div className="translation-key-panel">
              <label className="field-label" htmlFor="deepseek-key">DeepSeek API Key</label>
              <input
                id="deepseek-key"
                type="password"
                autoComplete="new-password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={keyConfigured ? '输入新密钥以更换' : '粘贴 API Key'}
                disabled={keyBusy}
              />
              <div className="translation-key-actions">
                <button type="button" className="btn primary" onClick={() => void saveKeyAndRetry()} disabled={!apiKey.trim() || keyBusy}>
                  <Check size={15} /> 保存并翻译
                </button>
                {keyConfigured && <button type="button" className="btn ghost" onClick={() => void deleteKey()} disabled={keyBusy}>删除密钥</button>}
                <button type="button" className="btn ghost" onClick={() => { setKeyPanelOpen(false); setApiKey(''); }} disabled={keyBusy}>关闭</button>
              </div>
            </div>
          )}
          <p className="translation-footnote">翻译由 DeepSeek 云端完成；原文会发送至 DeepSeek，图片与 `.pathlab` 工程仍保存在本机。</p>
        </div>

        <div className="dialog-foot">
          <button type="button" className="btn ghost" onClick={close} disabled={keyBusy}>取消</button>
          <button type="button" className="btn primary" onClick={applyTranslation} disabled={working || !translatedText.trim()}>
            <Download size={16} /> 追加到标注
          </button>
        </div>
      </div>
    </div>
  );
}
