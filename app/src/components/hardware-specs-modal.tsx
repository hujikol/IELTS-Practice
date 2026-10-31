import { TtsSettingsModal, type TtsSettingsModalProps } from './tts-settings-modal.tsx';

export interface HardwareSpecsModalProps extends TtsSettingsModalProps {}

/**
 * Re-exports TtsSettingsModal as HardwareSpecsModal for backward compatibility.
 * Provides model selection, minimum hardware requirements, live device diagnostics,
 * and audio cache management.
 */
export function HardwareSpecsModal(props: HardwareSpecsModalProps) {
  return <TtsSettingsModal {...props} />;
}
