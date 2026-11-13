import { useEffect, useState } from 'react'
import { classifyApiError } from '../../services/api/errors.js'
import { getProvider, PROVIDERS, PROVIDER_IDS, type ProviderId } from '../../services/api/providers.js'
import {
  setProvider,
  setProviderApiKey,
  setProviderModel,
  useSettings,
} from '../../services/settings.js'
import { loadModelsWithKey, refreshModels, useModels } from '../../services/models.js'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import styles from './Settings.module.css'

/**
 * 服务商与模型的配置区：
 * - 顶部切换对话服务商，切换后下面显示该服务商自己的 Key 与模型；
 * - Key 先校验再保存，校验通过后顺手拉取模型清单；
 * - 非 DeepSeek 服务商提示附件与语音需要另外配置 DeepSeek Key。
 */
export const ProviderSetting = () => {
  const t = useTranslate()
  const provider = useSettings((state) => state.provider)
  return (
    <div className={styles.cell}>
      <div className={styles.provider}>
        <div className={styles.label}>{t('settingsProvider')}</div>
        <Select
          ariaLabel={t('settingsProvider')}
          className={styles.providerSelect}
          value={provider}
          options={PROVIDER_IDS.map((id) => ({ value: id, label: PROVIDERS[id].name }))}
          onChange={setProvider}
        />
        <ProviderBody provider={provider} />
      </div>
    </div>
  )
}

/** 当前服务商的 Key 与模型；Key 保存后重新拉取模型清单 */
const ProviderBody = ({ provider }: { provider: ProviderId }) => {
  const t = useTranslate()
  const apiKey = useSettings((state) => state.apiKeys[provider])
  const savedModel = useSettings((state) => state.models[provider])
  const models = useModels((state) => state.lists[provider])
  const loading = useModels((state) => state.loading[provider])
  const [value, setValue] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 已有 Key 但还没拉过清单时补拉一次
  useEffect(() => {
    if (apiKey && models.length === 0 && !loading) {
      void refreshModels(provider)
    }
  }, [apiKey, models.length, loading, provider])

  const submit = async () => {
    const key = value.trim()
    if (!key || verifying) {
      return
    }
    setVerifying(true)
    setError(null)
    try {
      // 保存前先拉一次模型清单校验 Key，避免存下一个不可用的 Key
      await verifyKey(provider, key)
      setProviderApiKey(provider, key)
      setValue('')
      await refreshModels(provider)
    } catch (e) {
      setError(
        classifyApiError(e) === 'unauthorized'
          ? t('apiKeyInvalid')
          : classifyApiError(e) === 'cors'
            ? t('apiKeyCorsBlocked')
            : classifyApiError(e) === 'network'
              ? t('commonNetworkErrorToast')
              : t('apiKeyVerificationFailed', {
                  message: e instanceof Error ? e.message : String(e),
                })
      )
    } finally {
      setVerifying(false)
    }
  }

  const defaultModel = getProvider(provider).defaultModel
  const options =
    models.length > 0
      ? models.map((model) => ({ value: model.id, label: model.label }))
      : [{ value: defaultModel, label: defaultModel }]

  return (
    <>
      {apiKey ? (
        <div className={styles.apiKeySaved}>
          <span className={styles.apiKeyMask}>{'*'.repeat(apiKey.length)}</span>
          <Button variant="outlined" size="s" onClick={() => setProviderApiKey(provider, null)}>
            {t('apiKeyClear')}
          </Button>
        </div>
      ) : (
        <div className={styles.apiKeyInput}>
          <input
            type="password"
            placeholder={t('apiKeyPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                void submit()
              }
            }}
          />
          {value.trim() ? (
            <button
              type="button"
              className={styles.confirm}
              disabled={verifying}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void submit()}
            >
              {verifying ? t('apiKeyVerifying') : t('confirm')}
            </button>
          ) : null}
        </div>
      )}
      {error ? <div className={styles.error}>{error}</div> : null}
      <div className={styles.modelRow}>
        <span className={styles.description}>{t('settingsModel')}</span>
        <Select
          ariaLabel={t('settingsModel')}
          value={savedModel ?? defaultModel}
          options={options}
          disabled={loading}
          onChange={(model) => setProviderModel(provider, model)}
        />
      </div>
      {provider !== 'deepseek' ? (
        <div className={styles.description}>{t('settingsProviderAttachmentHint')}</div>
      ) : null}
    </>
  )
}

/** 用尚未保存的 Key 拉一次清单：既能校验 Key 是否可用，也能立刻得到模型选项 */
const verifyKey = async (provider: ProviderId, apiKey: string) => {
  await loadModelsWithKey(provider, apiKey)
}
