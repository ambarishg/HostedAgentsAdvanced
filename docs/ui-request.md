# UI Agent Invocation

The UI supports both single-request and configured batch invocation modes.

- **Single request:** The UI must include the text entered in the **User request** field as `user_input` in the invocation body. The agent processes that request.
- **Batch processing:** The UI must omit `user_input` entirely from the invocation body. The agent processes the input file or blob configured for batch mode; text in the UI's request field must not be used or sent.

The **Invoke using configured batch input** toggle selects the mode and sends an explicit `batch_mode` boolean with the request. When enabled, the UI disables the user-input field and omits `user_input` from the JSON request. Batch input must already be configured on the agent using `BATCH_FILE_PATH` and `BATCH_VALUE_COLUMN`, or the corresponding Blob settings. When disabled, the UI sends `batch_mode: false` and the user-input field and validates that it is not blank; the agent must honor this explicit choice even when batch input is also configured on the server.

For clients that omit `batch_mode`, the agent keeps its prior behavior: configured batch input selects batch processing; otherwise it requires and processes `user_input`.