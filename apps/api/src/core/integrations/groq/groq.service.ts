import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GroqChoice {
  message: { role: string; content: string };
  finish_reason: string;
}

interface GroqResponse {
  choices: GroqChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

@Injectable()
export class GroqService {
  private readonly logger = new Logger(GroqService.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl = 'https://api.groq.com/openai/v1/chat/completions';

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('GROQ_API_KEY', '');
    this.model = this.config.get<string>(
      'GROQ_MODEL',
      'llama-3.3-70b-versatile',
    );
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async chat(
    messages: ChatMessage[],
    options?: {
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<string> {
    if (!this.isConfigured) {
      this.logger.warn('GROQ_API_KEY no configurada, se omite llamada al LLM');
      return '';
    }

    const body = {
      model: this.model,
      messages,
      temperature: options?.temperature ?? 0.4,
      max_tokens: options?.maxTokens ?? 300,
    };

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Groq API ${res.status}: ${text}`);
      throw new Error(`Groq API error ${res.status}`);
    }

    const data = (await res.json()) as GroqResponse;
    const content = data.choices?.[0]?.message?.content ?? '';

    if (data.usage) {
      this.logger.debug(
        `Groq tokens: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out`,
      );
    }

    return content.trim();
  }
}
