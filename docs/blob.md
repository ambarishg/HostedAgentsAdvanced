Presently, the Orchestrator is configured to take a USER prompt.

Do the following:

1. The input is a file in Azure Blob Storage. The Orchestrator reads the file and fetches the configured `BATCH_VALUE_COLUMN`.
2. The value from that column in each row is used as that row's USER prompt; no separate USER prompt is required.
3. The Orchestrator generates a response and pushes it to the Persistence API for each row.

Batch invocation does not use `user_input`; that field is only used for single-request processing.

Ensure that the Orchestrator can handle large files efficiently and process each row in a timely manner. Implement error handling for file reading and response generation.