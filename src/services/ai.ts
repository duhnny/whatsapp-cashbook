import { agentMemory, db, model } from '../config/config.js';
import { err, ok, tryCatch } from '../utils/result.js';

import z from 'zod';
import { createAgent } from 'langchain';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { TransactionCategory } from '../../prisma/client/enums.js';
import { InfoLvl, logger } from '../utils/logging.js';


class UnableToInvokeModelError extends Error {
  readonly _tag = 'UnableToInvokeModel'
  message: string

  constructor(message: string) {
    super();
    this.message = message;
  }
}

class AIService {
  private getCurrentTimePromptLine() {
    const timezone = "America/Sao_Paulo";
    const now = new Date();

    const formatter = new Intl.DateTimeFormat("sv-SE", { // 'sv-SE' gera formato YYYY-MM-DD nativamente
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    // Transforma o array de partes em um objeto fácil de acessar
    const parts = formatter.formatToParts(now);
    const dateMap = Object.fromEntries(
      parts.map((part) => [part.type, part.value])
    );

    const isoGmt3 = `${dateMap.year}-${dateMap.month}-${dateMap.day}T${dateMap.hour}:${dateMap.minute}:${dateMap.second}-03:00`;

    return `A data e hora atual do servidor (já em GMT-3) é: ${isoGmt3}.`;
  }

  public async createOutboxTransaction(userId: number, sessionId: number, prompt: string) {
    const createOutboxTransactionTool = new DynamicStructuredTool({
      name: 'register_transaction',
      description: 'registers a transaction that the user made',
      schema: z.object({
        value: z.number().describe('The value of the transaction. If the money left the account, use a negative number, and if the money is entering the account, use a positive number'),
        category: z.enum(TransactionCategory).describe('The category of the transaction'),
        description: z.string().describe('A very short description or title of the transaction'),
        timestamp: z.iso.datetime({ offset: true, }).describe('The time in which the transaction took place, using GMT-3. If not specified, leave undefined.'),
      }),
      func: async ({ value, category, description, timestamp }) => {
        const outboxTransaction = await tryCatch(db.outboxTransaction.create({
          data: {
            sessionId,
            amount: value,
            category,
            description,
            createdAt: timestamp || new Date(),
          },
        }));

        if (outboxTransaction._tag === 'err') {
          throw outboxTransaction.error;
        }

        return {
          success: true,
        };
      }
    });


    // build system prompt
    const systemPrompt = `Você é um assistente de IA especializado e focado exclusivamente no registro de transações financeiras. Sua única tarefa é ler a mensagem do usuário, identificar e categorizar o gasto, e executar a ferramenta 'register_transaction'.

### Contexto Temporal do Sistema (CRÍTICO)
- ${this.getCurrentTimePromptLine()}.
- Use este ponto de referência para calcular datas relativas como "hoje", "ontem", "anteontem" ou "semana passada".

### Assinatura da Tool (TypeScript)
A ferramenta que você deve invocar possui a seguinte estrutura:
\`\`\`typescript
function register_transaction(params: {
  description: string;
  amount: number;
  category: string;
  timestamp?: string; // String no formato ISO 8601 representando data/hora no fuso GMT-3 (ex: "YYYY-MM-DDTHH:mm:ss-03:00")
}): void;
\`\`\`

### Diretrizes de Comportamento
1. Foco Total: Não responda a saudações longas, não dê conselhos e não saia do escopo de registro de despesas.
2. Tratamento do Campo 'timestamp' (GMT-3):
   - Se o usuário NÃO mencionar quando o gasto ocorreu, assuma que foi no momento atual e preencha o campo utilizando o ISO datetime fornecido no "Contexto Temporal do Sistema".
   - Se o usuário mencionar um momento passado (ex: "ontem", "sexta passada", "dia 15 às 14h"), calcule o retroativo correspondente e formate a string mantendo o offset \`-03:00\`.
3. Dados Incompletos: Se faltarem dados essenciais (valor ou descrição), peça apenas o que falta de forma curta.

### Parâmetros da Ferramenta
- 'description' (string): O item, serviço ou local (ex: "Uber", "Supermercado Extra").
- 'amount' (number): O valor da transação como um número negativo (ex: -45.90), se a transação for uma compra, ou positivo, se a transação for um recebimento.
- 'category' (string): A categoria do gasto, obrigatoriamente uma das seguintes: ${Object.keys(TransactionCategory).join(', ')}.
- 'timestamp' (string): String ISO 8601 com offset -03:00 (ex: "2026-10-30T09:58:00-03:00").

### Exemplos de Fluxo (Baseados no contexto de 30/10/2026 às 09:58)

Exemplo 1 (Gasto no momento atual):
Usuário: "Acabei de gastar R$ 35,00 no McDonald's"
Agente: [Chama a tool: register_transaction(description="McDonald's", amount=-35.00, category="${TransactionCategory.food_and_beverage}", timestamp="2026-10-30T09:58:00-03:00")]

Exemplo 2 (Gasto ontem):
Usuário: "Paguei 120 reais na farmácia Droasil ontem"
Agente: [Chama a tool: register_transaction(description="Farmácia Droasil", amount=-120.00, category="${TransactionCategory.groceries}", timestamp="2026-10-29T09:58:00-03:00")]

Analise a próxima mensagem do usuário e execute a ação apropriada.
    `;

    const transactionsAgent = createAgent({
      model,
      tools: [createOutboxTransactionTool],
      checkpointer: agentMemory,
      systemPrompt,
    });

    const response = await tryCatch(transactionsAgent.invoke(
      {
        messages: [{
          role: 'human',
          content: prompt,
        }],
      },
      {
        configurable: {
          thread_id: `transaction_${userId}_${sessionId}`,
        },
      },
    ));

    if (response._tag === 'err') {
      logger.log(InfoLvl.Error, 'Unable to invoke agent to register transactions', {
        userId,
        sessionId,
        error: response.error,
      });
      return err(new UnableToInvokeModelError('Error while trying to invoke agent'));
    }

    if (response.value.messages.length === 0) {
      logger.log(InfoLvl.Warning, 'Invoking agent did not return any messages', {
        userId,
        sessionId,
      });
      return ok({
        message: '[No message]',
      });
    }

    return ok({
      message: response.value.messages.at(-1)!.text,
    });
  }
}

export const aiService = new AIService();
