import type { ThreadChannel } from 'discord.js'
import {
  showStructuredQuestionDropdowns,
  type AskUserQuestionDefinition,
} from '../commands/ask-question.js'
import { createLogger, LogPrefix } from '../logger.js'
import { type CodexAppServerClient } from './client.js'
import type {
  RequestUserInputParams,
  RequestUserInputResponse,
  TurnPlanUpdatedParams,
} from './types.js'

const logger = createLogger(LogPrefix.ASK_QUESTION)

export type NormalizedAppServerPlan = {
  explanation: string | null
  steps: Array<{
    text: string
    status: 'pending' | 'inProgress' | 'completed'
  }>
}

export function normalizeAppServerPlanUpdate({
  params,
}: {
  params: TurnPlanUpdatedParams
}): NormalizedAppServerPlan {
  return {
    explanation: params.explanation ?? null,
    steps: params.plan.map((step) => {
      return {
        text: step.step,
        status: step.status,
      }
    }),
  }
}

function buildStructuredQuestions({
  params,
}: {
  params: RequestUserInputParams
}): AskUserQuestionDefinition[] {
  return params.questions.map((question) => {
    return {
      id: question.id,
      header: question.header,
      question: question.question,
      options: question.options ?? [],
      multiple: false,
    }
  })
}

function buildRequestUserInputResponse({
  answersByQuestionId,
}: {
  answersByQuestionId: Record<string, string[]>
}): RequestUserInputResponse {
  const answers: RequestUserInputResponse['answers'] = {}
  for (const [questionId, selectedAnswers] of Object.entries(
    answersByQuestionId,
  )) {
    answers[questionId] = {
      answers: selectedAnswers,
    }
  }
  return { answers }
}

export async function showAppServerQuestionDropdowns({
  thread,
  client,
  requestId,
  params,
  silent,
}: {
  thread: ThreadChannel
  client: CodexAppServerClient
  requestId: string
  params: RequestUserInputParams
  silent?: boolean
}): Promise<void> {
  const questions = buildStructuredQuestions({ params })

  await showStructuredQuestionDropdowns({
    thread,
    requestId,
    questions,
    silent,
    sessionId: params.turnId,
    directory: params.threadId,
    logLabel: `app-server turn ${params.turnId}`,
    submitAnswers: async ({ answersByQuestionId }) => {
      const response = buildRequestUserInputResponse({ answersByQuestionId })
      client.respondToRequestUserInput({
        requestId,
        response,
      })
      logger.log(
        `Submitted app-server question response for turn ${params.turnId} request ${requestId}`,
      )
    },
    replyWithUserMessage: async ({ userMessage, context }) => {
      const response = buildRequestUserInputResponse({
        answersByQuestionId: Object.fromEntries(
          context.questions.map((question) => {
            return [question.id, [userMessage]]
          }),
        ),
      })
      client.respondToRequestUserInput({
        requestId,
        response,
      })
      logger.log(
        `Answered app-server question ${requestId} with freeform user message`,
      )
    },
    onExpire: async () => {
      client.respondToRequestUserInput({
        requestId,
        response: { answers: {} },
      })
      logger.warn(
        `Expired app-server question ${requestId}; responded with empty answers`,
      )
    },
  })
}
