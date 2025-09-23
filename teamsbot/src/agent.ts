
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

    // Get configuration for the AI Foundry project and agent
    const projectEndpoint = process.env["AI_FOUNDRY_ENDPOINT"] || "http://localhost/";
    const modelDeploymentName = process.env["AI_FOUNDRY_MODEL_NAME"] || "gpt-4o";
    const agentId = process.env["AI_FOUNDRY_AGENT_ID"] || "";
    console.log(`# Project Endpoint: ${projectEndpoint}, Model Deployment Name: ${modelDeploymentName}, Agent ID: ${agentId}`);

    // Create Azure credential (optionally using managed identity)
    const credential = new DefaultAzureCredential({ managedIdentityClientId: process.env["AI_FOUNDRY_CLIENT_ID"] });
    if (!credential) {
        // If credential creation fails, log and notify user
        console.error("Error: Unable to create credential.");
        await context.sendActivity("Error: Unable to create credential.");
    }
    console.log(`# Credential: ${JSON.stringify(credential)}`);

    // Create the AIProjectClient for interacting with the AI Foundry API
    const project = new AIProjectClient(projectEndpoint, credential);
    if (!project) {
        // If project client creation fails, log and notify user
        console.error("Error: Unable to create project client.");
        await context.sendActivity("Error: Unable to create project client.");
    }
    console.log(`# Project: ${project.getEndpointUrl()}`);
    try {
        // Retrieve the agent definition from the project
        const agent = await project.agents.getAgent(agentId);
        if (!agent) {
            // If agent is not found, log and notify user
            console.error("Error: Agent not found.");
            await context.sendActivity("Error: Agent not found.");
        }
        console.log(`# Agent: ${JSON.stringify(agent)}`);

        // Retrieve or create a conversation thread for this user
        const thread = (state.conversation.threadId)
            ? await project.agents.threads.get(state.conversation.threadId)
            : await project.agents.threads.create();
        if (!thread) {
            // If thread retrieval/creation fails, log and notify user
            console.error("Failed to retrieve or create thread.");
            await context.sendActivity("Error: Unable to retrieve or create thread.");
        }
        console.log(`# Thread ID: ${thread.id}`);
        // Store thread ID in conversation state for future use
        state.conversation.threadId = thread.id;
        if (!thread) {
            // Double-check for thread existence
            console.error("Failed to retrieve or create thread.");
            await context.sendActivity("Error: Unable to retrieve or create thread.");
        } else {
            // Create a new message in the thread from the user input
            const message = await project.agents.messages.create(thread.id, "user", `${context.activity.text}`);
            if (!message) {
                // If message creation fails, log and notify user
                console.error("Failed to create message.");
                await context.sendActivity("Error: Unable to create message.");
            }
            console.log(`Message created: ${JSON.stringify(message)}`);

            // Start a new run for the agent to process the message
            let run = await project.agents.runs.create(thread.id, agent.id)
            if (!run) {
                // If run creation fails, log and notify user
                console.error("Failed to create run.");
                await context.sendActivity("Error: Unable to create run.");
            }
            console.log(`Run created: ${JSON.stringify(run)}`);

            // Poll the run status until it is no longer queued or in progress
            while (run.status === "queued" || run.status === "in_progress") {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second
                run = await project.agents.runs.get(thread.id, run.id);
            }
            console.log(`Run completed with status: ${run.status}`);
            if (run.status === "failed") {
                // If the run failed, log and notify user
                console.error("Run failed with status: " + run.status);
                await context.sendActivity(`[${count}] Run failed with status: ${run.status}`);
            } else {
                // Retrieve the latest messages from the thread (descending order)
                const messages = await project.agents.messages.list(thread.id, { order: "desc" });
                console.log(`Messages: ${JSON.stringify(messages)}`);
                // Get the most recent message
                const m = await messages.next();
                console.log(`Message: ${JSON.stringify(m)}`);

                // Build and send an Adaptive Card using the provided sample input
                // Dynamically build the Adaptive Card from the message content
                let textValue = "";
                let citationTexts: string[] = [];
                const content = m.value.content;
                if (Array.isArray(content) && content.length > 0 && content[0].type === "text") {
                    textValue = content[0].text.value;
                    // If there are annotations, try to extract all citations
                    if (content[0].text.annotations && content[0].text.annotations.length > 0) {
                        const citations = content[0].text.annotations.filter((a: any) => a.type === "url_citation" && a.urlCitation);
                        citationTexts = citations.map((citation: any) => `Source: [${citation.urlCitation.title}](${citation.urlCitation.url})`);
                    }
                } else {
                    textValue = typeof content === "string" ? content : JSON.stringify(content);
                }
                const adaptiveCard = {
                    type: "AdaptiveCard",
                    version: "1.4",
                    body: [
                        {
                            type: "TextBlock",
                            text: textValue,
                            wrap: true
                        },
                        ...(
                            citationTexts.length > 0
                                ? citationTexts.map(text => ({
                                    type: "TextBlock",
                                    text,
                                    wrap: true,
                                    spacing: "Small",
                                    isSubtle: true
                                }))
                                : []
                        )
                    ],
                    actions: [
                        { 
                            type: "Action.ShowCard",
                            title: "Debug Info",
                            card: {
                                type: "AdaptiveCard",
                                body: [
                                    {
                                        type: "TextBlock",
                                        text: `Run ID: ${run.id}\nThread ID: ${thread.id}\nAgent ID: ${agent.id}`,
                                        wrap: true
                                    },
                                    {
                                        type: "TextBlock",
                                        text: `Input: ${context.activity.text}`,
                                        wrap: true
                                    }
                                ]
                            }
                        }
                    ],
                    $schema: "http://adaptivecards.io/schemas/adaptive-card.json"
                };
                await context.sendActivity(
                    MessageFactory.attachment({
                        contentType: "application/vnd.microsoft.card.adaptive",
                        content: adaptiveCard
                    })
                );
            }
        }
    } catch (error) {
        // Catch and log any errors during the run, and notify the user
        console.error("Error during run:", error);
        await context.sendActivity(`[${count}] Error during run: ${error}`);
    }

    //await context.sendActivity(`[${count}] echoing: ${context.activity.text}`)
})