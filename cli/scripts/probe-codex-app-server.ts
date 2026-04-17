import { createLogger, LogPrefix } from '../src/logger.js'
import { CodexAppServerClient } from '../src/codex-app-server/client.js'
import {
  isRequestUserInputEvent,
  isThreadStatusChangedEvent,
  isThreadTokenUsageUpdatedEvent,
  isTurnCompletedEvent,
  isTurnPlanUpdatedEvent,
  type CollaborationMode,
} from '../src/codex-app-server/types.js'

const logger = createLogger(LogPrefix.CLI)

type ProbeArgs = {
  mode: 'default' | 'plan'
  message: string
  autoAnswer: string | null
}

function parseArgs(argv: string[]): ProbeArgs {
  let mode: ProbeArgs['mode'] = 'default'
  let message =
    'Say only: codex app-server probe ok'
  let autoAnswer: string | null = null

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg) {
      continue
    }
    if (arg === '--mode') {
      const value = argv[i + 1]
      if (value === 'default' || value === 'plan') {
        mode = value
        i++
      }
      continue
    }
    if (arg === '--message') {
      const value = argv[i + 1]
      if (value) {
        message = value
        i++
      }
      continue
    }
    if (arg === '--auto-answer') {
      autoAnswer = argv[i + 1] ?? null
      if (argv[i + 1]) {
        i++
      }
    }
  }

  if (mode === 'plan' && autoAnswer === null) {
    autoAnswer = 'Start new branch'
  }

  return { mode, message, autoAnswer }
}

function buildCollaborationMode({
  mode,
}: {
  mode: ProbeArgs['mode']
}): CollaborationMode | null {
  if (mode === 'default') {
    return null
  }

  return {
    mode: 'plan',
    settings: {
      model: 'gpt-5.4',
      reasoning_effort: 'xhigh',
      developer_instructions: null,
    },
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const client = new CodexAppServerClient()

  try {
    const initialize = await client.initialize()
    logger.info(
      'app-server initialized',
      initialize.codexHome,
      initialize.platformOs,
    )

    const thread = await client.startThread({
      model: 'gpt-5.4',
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    })

    logger.info('thread started', thread.thread.id)

    const turn = await client.startTurn({
      threadId: thread.thread.id,
      input: [
        {
          type: 'text',
          text: args.message,
          text_elements: [],
        },
      ],
      collaborationMode: buildCollaborationMode({ mode: args.mode }),
    })

    logger.info('turn started', turn.turn.id, `mode=${args.mode}`)

    while (true) {
      const event = await client.nextEvent({ timeoutMs: 30_000 })
      if (!event) {
        logger.warn('probe timed out waiting for app-server event')
        break
      }

      if (isThreadStatusChangedEvent(event)) {
        logger.info(
          'thread status',
          event.params.threadId,
          JSON.stringify(event.params.status),
        )
        continue
      }

      if (isTurnPlanUpdatedEvent(event)) {
        logger.info(
          'plan updated',
          JSON.stringify({
            explanation: event.params.explanation,
            plan: event.params.plan,
          }),
        )
        continue
      }

      if (isRequestUserInputEvent(event)) {
        logger.info(
          'request user input',
          JSON.stringify(event.params.questions),
        )

        if (args.autoAnswer) {
          const firstQuestion = event.params.questions[0]
          if (firstQuestion) {
            client.respondToRequestUserInput({
              requestId: event.id,
              response: {
                answers: {
                  [firstQuestion.id]: {
                    answers: [args.autoAnswer],
                  },
                },
              },
            })
            logger.info('sent request_user_input response', args.autoAnswer)
          }
        }
        continue
      }

      if (isThreadTokenUsageUpdatedEvent(event)) {
        logger.info(
          'token usage',
          JSON.stringify(event.params.tokenUsage),
        )
        continue
      }

      if (event.method === 'item/completed') {
        logger.info('item completed', JSON.stringify(event.params))
        continue
      }

      if (isTurnCompletedEvent(event)) {
        logger.info('turn completed', JSON.stringify(event.params.turn))
        break
      }

      logger.info('event', event.method, JSON.stringify(event.params ?? null))
    }
  } finally {
    client.dispose()
  }
}

void main().catch((error: unknown) => {
  logger.error('probe failed', error)
  process.exitCode = 1
})
