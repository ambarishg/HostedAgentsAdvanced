For the Orchestrator, the structured output is a JSON object with the following fields:
Return one valid JSON object per call, using exactly the following fields:

{
  "primary_contact_reason": "<one approved category or Not identified>",
  "confidence": "<High | Medium | Low>",
  "evidence": [
    "<brief quotation or faithful paraphrase from the transcript>",
    "<optional second supporting detail>"
  ],
  "rationale": "<one or two concise sentences explaining why this category best represents the main reason for contact>",
  "secondary_reasons": [
    "<optional other approved category explicitly supported by the transcript>"
  ]
}

Make sure that the Orchestrator's structured output is always a valid JSON object, even if the transcript is empty or does not contain enough information to identify a primary contact reason. In such cases, use "Not identified" for the primary_contact_reason and provide an appropriate rationale.

