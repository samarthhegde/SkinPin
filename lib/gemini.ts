type GeminiReasoningInput = {
  symptoms: string;
  condition: string;
  confidence: number;
  urgency: string;
  whenToSeeDoctor: string;
};

export async function getGeminiExplanation(input: GeminiReasoningInput): Promise<string | null> {
  const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `
You are a clinical triage assistant for a hackathon prototype.
Given the consensus output, produce a short, patient-friendly explanation in 3 bullet points:
1) what was detected
2) why that recommendation was given
3) immediate next step

Symptoms: ${input.symptoms || "none provided"}
Condition: ${input.condition}
Confidence: ${(input.confidence * 100).toFixed(0)}%
Urgency: ${input.urgency}
When to see doctor: ${input.whenToSeeDoctor}

Important: include a disclaimer that this is not a medical diagnosis.
`.trim();

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 220 },
        }),
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text && typeof data.candidates[0].content.parts[0].text === "string"
        ? data.candidates[0].content.parts[0].text
        : null;
    return text;
  } catch {
    return null;
  }
}
