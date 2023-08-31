import { Message } from '../stores/types'
import * as wordCount from './utils'
import { createParser } from 'eventsource-parser'

export interface OnTextCallbackResult {
    // response content
    text: string
    // cancel for fetch
    cancel: () => void
}

export async function chat(
    apiKey: string,
    host: string,
    maxContextSize: string,
    maxTokens: string,
    modelName: string,
    temperature: number,
    msgs: Message[],
    onText?: (option: OnTextCallbackResult) => void,
    onError?: (error: Error) => void,
) {
    if (msgs.length === 0) {
        throw new Error('No messages to replay')
    }

    const head = msgs[0].role === 'system' ? msgs[0] : undefined
    if (head) {
        msgs = msgs.slice(1)
    }

    console.log("test2222  apikey",apiKey)
    const maxTokensNumber = Number(maxTokens)
    const maxLen = Number(maxContextSize)
    let totalLen = head ? wordCount.estimateTokens(head.content) : 0

    let prompts: Message[] = []
    for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i]
        const msgTokenSize: number = wordCount.estimateTokens(msg.content) + 200 // 200 作为预估的误差补偿
        if (msgTokenSize + totalLen > maxLen) {
            break
        }
        prompts = [msg, ...prompts]
        totalLen += msgTokenSize
    }
    if (head) {
        prompts = [head, ...prompts]
    }

    // fetch has been canceled
    let hasCancel = false
    // abort signal for fetch
    const controller = new AbortController()
    const cancel = () => {
        hasCancel = true
        controller.abort()
    }


    //
    let fullText = ''
    try {
        const messages = prompts.map((msg) => ({ role: msg.role, content: msg.content }))
        const url = 'https://yzfcz1y9t0.execute-api.ap-northeast-1.amazonaws.com/dev/api/db/dbopenaicheckkey';
// 你的POST数据

// 请求选项
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                id: apiKey
            })
        };
        console.log("test2222 checkKey start",msgs)
// 发送请求
     await   fetch(url, options)
            .then(response => response.json())
            .then(data => {
                console.log("test2222 checkKey result",data.code)

                if (data.code!=200){
                    throw new Error(` please set key`)
                }
            })
            .catch(error => {
                console.error('Error:', error)
                throw new Error(`server is error`)
            });
        console.log("test2222 checkKey end",msgs[1])
        const response = await fetch(`${host}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer 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`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messages,
                model: modelName,
                max_tokens: maxTokensNumber,
                temperature,
                stream: true,
            }),
            signal: controller.signal,
        })
        await handleSSE(response, (message) => {
            if (message === '[DONE]') {
                return
            }
            const data = JSON.parse(message)
            if (data.error) {
                throw new Error(`Error from OpenAI: ${JSON.stringify(data)}`)
            }
            const text = data.choices[0]?.delta?.content
            if (text !== undefined) {
                fullText += text
                if (onText) {
                    onText({ text: fullText, cancel })
                }
            }
        })
    } catch (error) {
        // if a cancellation is performed
        // do not throw an exception
        // otherwise the content will be overwritten.
        if (hasCancel) {
            return
        }
        if (onError) {
            onError(error as any)
        }
        throw error
    }
    return fullText
}

export async function handleSSE(response: Response, onMessage: (message: string) => void) {
    if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error ? JSON.stringify(error) : `${response.status} ${response.statusText}`)
    }
    if (response.status !== 200) {
        throw new Error(`Error from OpenAI: ${response.status} ${response.statusText}`)
    }
    if (!response.body) {
        throw new Error('No response body')
    }
    const parser = createParser((event) => {
        if (event.type === 'event') {
            onMessage(event.data)
        }
    })
    for await (const chunk of iterableStreamAsync(response.body)) {
        const str = new TextDecoder().decode(chunk)
        parser.feed(str)
    }
}

export async function* iterableStreamAsync(stream: ReadableStream): AsyncIterableIterator<Uint8Array> {
    const reader = stream.getReader()
    try {
        while (true) {
            const { value, done } = await reader.read()
            if (done) {
                return
            } else {
                yield value
            }
        }
    } finally {
        reader.releaseLock()
    }
}
