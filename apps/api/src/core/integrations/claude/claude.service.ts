import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

@Injectable()
export class ClaudeService {
  private readonly logger = new Logger(ClaudeService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY', '');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    this.model = this.config.get<string>('CLAUDE_MODEL', 'claude-haiku-4-5');

    if (!this.client) {
      this.logger.warn('ANTHROPIC_API_KEY no configurada, Claude deshabilitado');
    }
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  async chat(
    messages: ChatMessage[],
    options?: {
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<string> {
    if (!this.client) {
      this.logger.warn('Cliente no configurado, se omite llamada a Claude');
      return '';
    }

    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    const conversation = messages
      .filter((m): m is { role: 'user' | 'assistant'; content: string } =>
        m.role !== 'system',
      )
      .map((m) => ({ role: m.role, content: m.content }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 300,
      temperature: options?.temperature,
      system: system || undefined,
      messages: conversation,
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    return textBlock?.text.trim() ?? '';
  }
}
