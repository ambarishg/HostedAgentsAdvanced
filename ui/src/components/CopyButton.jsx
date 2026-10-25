import { useState } from 'react';

export function CopyButton({ value, label }) {
  const [copyMessage, setCopyMessage] = useState('');

  const copyValue = async () => {
    if (!navigator.clipboard?.writeText) {
      setCopyMessage('Clipboard access is unavailable in this browser.');
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage('Copied to clipboard.');
    } catch (copyError) {
      setCopyMessage(copyError.message || 'Unable to copy to clipboard.');
    }
  };

  return (
    <span className="copy-control">
      <button type="button" className="copy-button" onClick={copyValue} disabled={!value}>{label}</button>
      {copyMessage && <span className="copy-message" role="status">{copyMessage}</span>}
    </span>
  );
}
