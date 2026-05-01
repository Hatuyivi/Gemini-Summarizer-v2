import { Router, type IRouter, type Request, type Response } from "express";
import { GoogleGenAI } from "@google/genai";
import { ai as replitAi } from "@workspace/integrations-gemini-ai";

const router: IRouter = Router();

interface SummarizeBody {
  messages?: Array<{ role: string; content: string }>;
  previousSummary?: string | null;
}

/**
 * Free-tier Gemini models (per https://ai.google.dev/gemini-api/docs/rate-limits).
 * `gemini-2.5-flash` is the default summarizer because it has the best output
 * quality among free-tier models and the request volume of compression is low
 * (one call per ~20 chat messages).
 */
const FREE_TIER_MODEL = "gemini-2.5-flash";

router.post(
  "/summarize",
  async (req: Request<unknown, unknown, SummarizeBody>, res: Response) => {
    try {
      const { messages, previousSummary } = req.body ?? {};

      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages array is required" });
        return;
      }

      const transcript = messages
        .map(
          (m) =>
            `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`,
        )
        .join("\n\n");

      const prompt = `You are a context-compression engine for a multi-AI chat app.
Compress the following conversation into a compact memory block so a different AI assistant can pick up the conversation seamlessly.

${previousSummary ? `Previous compressed memory:\n${previousSummary}\n\n` : ""}New conversation to compress:
${transcript}

Return ONLY a single valid JSON object, no prose, no code fences, with this exact shape:
{
  "summary": "short compressed memory of the conversation so far, written so a new assistant can continue without losing context",
  "important_data": ["array of key facts, names, numbers, decisions or constraints worth preserving verbatim"],
  "tone": "one short phrase describing the conversational tone (e.g. 'friendly and technical')"
}`;

      const userKeyHeader = req.header("x-user-gemini-key");
      const userKey =
        typeof userKeyHeader === "string" && userKeyHeader.trim().length > 0
          ? userKeyHeader.trim()
          : null;

      let source: "user-key" | "replit";
      let client: GoogleGenAI;
      if (userKey) {
        client = new GoogleGenAI({ apiKey: userKey });
        source = "user-key";
      } else {
        client = replitAi;
        source = "replit";
      }

      const response = await client.models.generateContent({
        model: FREE_TIER_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
        },
      });

      const text = response.text ?? "";

      let parsed: {
        summary: string;
        important_data: string[];
        tone: string;
      };
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = {
          summary: text.slice(0, 2000),
          important_data: [],
          tone: "",
        };
      }

      res.json({ ...parsed, source });
    } catch (err) {
      req.log.error({ err }, "summarize failed");
      res.status(500).json({ error: "summarization failed" });
    }
  },
);

export default router;
