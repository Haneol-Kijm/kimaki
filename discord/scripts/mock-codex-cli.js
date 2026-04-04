#!/usr/bin/env node

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function writeEvent(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

function parseInvocation(argv) {
  const promptIndex = argv.indexOf('--')
  const prompt =
    promptIndex >= 0 ? argv.slice(promptIndex + 1).join(' ').trim() : ''

  const isResume = argv[0] === 'exec' && argv[1] === 'resume'
  const sessionId =
    isResume && promptIndex > 0 ? argv[promptIndex - 1] : undefined

  return {
    prompt,
    sessionId,
  }
}

async function main() {
  const { prompt, sessionId } = parseInvocation(process.argv.slice(2))
  const threadId = sessionId || `mock-session-${process.pid}`

  writeEvent({
    type: 'thread.started',
    thread_id: threadId,
  })

  if (prompt.includes('PLUGIN_TIMEOUT_SLEEP_MARKER')) {
    writeEvent({
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: 'starting sleep 100',
      },
    })
    await sleep(100_000)
    return
  }

  if (prompt.includes('SLOW_ABORT_MARKER run long response')) {
    writeEvent({
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: 'slow-response-started',
      },
    })
    await sleep(100_000)
    return
  }

  if (prompt.includes('User clicked: Continue action-buttons flow')) {
    writeEvent({
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: 'action-buttons-click-continued',
      },
    })
    return
  }

  if (prompt.includes('Reply with exactly:')) {
    writeEvent({
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: 'ok',
      },
    })
    return
  }

  writeEvent({
    type: 'item.completed',
    item: {
      type: 'agent_message',
      text: 'ok',
    },
  })
}

process.on('SIGTERM', () => {
  process.exit(0)
})

process.on('SIGINT', () => {
  process.exit(0)
})

void main().catch((error) => {
  writeEvent({
    type: 'turn.failed',
    error: {
      message: error instanceof Error ? error.message : String(error),
    },
  })
  process.exitCode = 1
})
