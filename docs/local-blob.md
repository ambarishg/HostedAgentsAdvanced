For local file processing as well as for the Blob processing make the following changes to the Orchestrator:

1. User Prompt is not required to be passed as input to the Orchestrator. The Orchestrator will read the local file and extract the USER prompt from the BATCH_VALUE_COLUMN.          

2. For invocation for batch processing do not use the user input . This is only applicable when using a single request.
