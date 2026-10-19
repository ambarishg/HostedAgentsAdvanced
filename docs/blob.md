Presently the Orchestrator is configured to take a USER prompt.

Do the following:

1. The input will be a File in Azure Blob Storage. The Orchestrator will read the file and extract the USER prompt from it.
2. The Orchestrator will then use the extracted USER prompt to generate a response.
3. The Orchestrator will fetch a predefined column from the file in Azure Blob Storage and use it to generate a response.
4. The Orchestrator will read each row of the file in Azure Blob Storage and generate a response for each row based on the extracted USER prompt and the predefined column.
5. Presently , the Orchestrator pushes the generated response to the Persistence API. The Orchestrator will now do this for each row of the file in Azure Blob Storage.

Make the necessary changes to the Orchestrator to implement the above functionality. Ensure that the Orchestrator can handle large files efficiently and can process each row in a timely manner. Additionally, implement error handling to manage any issues that may arise during file reading or response generation.