
// Import necessary classes and types from the Agents SDK
import { TurnState, MemoryStorage, TurnContext, AgentApplication, AttachmentDownloader, MessageFactory }
    from '@microsoft/agents-hosting'
import { version } from '@microsoft/agents-hosting/package.json'
import { ActivityTypes } from '@microsoft/agents-activity'
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import { stat } from 'fs';

// Define the shape of the conversation state
interface ConversationState {
    count: number;
    threadId?: string; // Optional thread ID for tracking conversation threads
}
// Alias for the application turn state
type ApplicationTurnState = TurnState<ConversationState>


// Create an attachment downloader for handling file attachments
const downloader = new AttachmentDownloader()

// Use in-memory storage for conversation state
const storage = new MemoryStorage()

// Create the main AgentApplication instance
export const agentApp = new AgentApplication<ApplicationTurnState>({
    storage,
    fileDownloaders: [downloader],
    authorization: {
        graph: { text: 'Sign in with Microsoft Graph', title: 'Graph Sign In' }
    }
})

agentApp.authorization.onSignInSuccess(async (context: TurnContext, state: TurnState) => {
    console.log('User signed in successfully')
    await context.sendActivity('User signed in successfully')
})

const status = async (context: TurnContext, state: ApplicationTurnState) => {
    await context.sendActivity(MessageFactory.text('Welcome to the Secure Bot Agent with auth demo!'))
    const tokGraph = await agentApp.authorization.getToken(context, 'graph')
    const statusGraph = tokGraph.token !== undefined
    await context.sendActivity(MessageFactory.text(`Token status: Graph:${statusGraph}`))
}

const base64UrlEncode = (str: string) => {
    // Encode the string to Base64
    let base64 = btoa(str);
    // Replace '+' with '-' and '/' with '_'
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const base64UrlDecode = (base64Url: string) => {
    // Replace '-' with '+' and '_' with '/'
    let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding if necessary
    switch (base64.length % 4) {
        case 2: base64 += '=='; break;
        case 3: base64 += '='; break;
    }
    return atob(base64); // Decode the Base64 string
}

agentApp.onMessage('/status', status, ['graph'])

agentApp.onMessage('/me', async (context: TurnContext, state: ApplicationTurnState) => {
    const oboToken = await agentApp.authorization.exchangeToken(context, ['https://graph.microsoft.com/.default'], 'graph')
    if (oboToken.token) {

        console.log(`||| Token: ${oboToken.token} |||`)
        const resp = await fetch('https://graph.microsoft.com/v1.0/me', {
            headers: {
                Authorization: `Bearer ${oboToken.token}`
            }
        });
        const respjson = await resp.json();
        await context.sendActivity(MessageFactory.text(`Profile Json: ${JSON.stringify(respjson)}`))
    } else {
        await context.sendActivity(MessageFactory.text('No valid token found.'))
    }
}, ['graph'])

// Handler for the /reset command: clears the conversation state
agentApp.onMessage('/reset', async (context: TurnContext, state: ApplicationTurnState) => {
    state.deleteConversationState()
    await context.sendActivity('Deleted current conversation state.')
})


// Handler for the /count command: replies with the current message count
agentApp.onMessage('/count', async (context: TurnContext, state: ApplicationTurnState) => {
    const count = state.conversation.count ?? 0
    await context.sendActivity(`The conversation count is ${count}`)
})


// Handler for the /diag command: sends the raw activity object for diagnostics
agentApp.onMessage('/diag', async (context: TurnContext, state: ApplicationTurnState) => {
    await state.load(context, storage)
    await context.sendActivity(JSON.stringify(context.activity))
})


// Handler for the /state command: sends the current state object
agentApp.onMessage('/state', async (context: TurnContext, state: ApplicationTurnState) => {
    await state.load(context, storage)
    await context.sendActivity(JSON.stringify(state))
})


// Handler for the /runtime command: sends Node.js and SDK version info
agentApp.onMessage('/runtime', async (context: TurnContext, state: ApplicationTurnState) => {
    const runtime = {
        nodeversion: process.version,
        sdkversion: version
    }
    await context.sendActivity(JSON.stringify(runtime))
})


// Welcome message when a new member is added to the conversation
agentApp.onConversationUpdate('membersAdded', async (context: TurnContext, state: ApplicationTurnState) => {
    await context.sendActivity('Hello from the Secure Bot Agent running Agents SDK version: ' + version)
    await status(context, state)
})


// Handler for activities whose type matches the regex /^message/
agentApp.onMessage(/^message/, async (context: TurnContext, state: ApplicationTurnState) => {
    await context.sendActivity(`Matched with regex: ${context.activity.type}`)
})

// Handler for message who starts with /base64url 
agentApp.onMessage(/^\/base64url/, async (context: TurnContext, state: ApplicationTurnState) => {
    const inputTextArr = context.activity?.text?.split(' ')
    if (!inputTextArr || inputTextArr.length < 2) {
        await context.sendActivity('Usage: /base64url <text>')
    } else if (inputTextArr.length >= 2) {
        switch (inputTextArr[1]) {
            case '-d':
                const decodedText = base64UrlDecode(inputTextArr.slice(2).join(' '))
                await context.sendActivity(`Decoded: ${decodedText}`)
                break;
            default:
                const encodedText = base64UrlEncode(inputTextArr.slice(1).join(' '))
                await context.sendActivity(`Encoded: ${encodedText}`)
                break;
        }
    }
})


// Generic message handler: increments count and echoes the user's message
agentApp.onActivity(ActivityTypes.Message, async (context: TurnContext, state: ApplicationTurnState) => {
    // Retrieve and increment the conversation message count
    let count = state.conversation.count ?? 0
    state.conversation.count = ++count


    await context.sendActivity(`[${count}] echoing: ${context.activity.text}`)
})