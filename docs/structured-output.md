For the Orchestrator, the structured output is a JSON object with the following fields:

Return one valid JSON object per call, using exactly the following fields:

{
  "primary_contact_reason": "<one approved PCR category or Not identified>",
  "demand_driver": "<one approved demand-driver category or Not identified>",
  "confidence": "<High | Medium | Low>",
  "evidence": [
    "<brief quotation or faithful paraphrase supporting the PCR>",
    "<optional second supporting detail for the PCR>"
  ],
  "rationale": "<one or two concise sentences explaining why the PCR best represents the main reason for contact>",
  "secondary_reasons": [
    "<optional other approved PCR category explicitly supported by the transcript>"
  ],
  "demand_driver_evidence": [
    "<brief quotation or faithful paraphrase supporting the demand driver>"
  ],
  "demand_driver_rationale": "<one concise sentence explaining the underlying event, circumstance, problem, or need; state when evidence is insufficient>"
}


Make sure that the Orchestrator's structured output is always a valid JSON object, even if the transcript is empty or does not contain enough information to identify a primary contact reason. In such cases, use "Not identified" for the primary_contact_reason and provide an appropriate rationale.

Make sure to read the prompts\system_prompt.example.txt for detailed instructions on how to generate the structured output.