
// Import necessary classes and types from the Agents SDK
import { TurnState, MemoryStorage, TurnContext, AgentApplication, AttachmentDownloader, MessageFactory }
    from '@microsoft/agents-hosting'
import { version } from '@microsoft/agents-hosting/package.json'
import { ActivityTypes } from '@microsoft/agents-activity'
import type {
    MessageContent,
    MessageTextContent,
    SubmitToolApprovalAction,
    RequiredMcpToolCall,
    ThreadMessage,
    ToolApproval,
    RunStepToolCallDetails,
} from "@azure/ai-agents";
import { AgentsClient, ToolSet, isOutputOfType } from "@azure/ai-agents";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import { stat } from 'fs';

// Define the shape of the conversation state
interface ConversationState {
    count: number;
    threadId?: string; // Optional thread ID for tracking conversation 
    agentId?: string; // Optional agent ID for the AI Foundry agent
    toolSet?: ToolSet; // Optional toolset for the agent
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


const initializeAIFoundryAgent = async (context: TurnContext, state: ApplicationTurnState) => {
    const projectEndpoint = String(process.env['AI_FOUNDRY_ENDPOINT']);
    const modelDeploymentName = String(process.env['AI_FOUNDRY_MODEL']);
    const client = new AgentsClient(projectEndpoint, new DefaultAzureCredential());
    const toolSet = new ToolSet();
    toolSet.addMCPTool({
        serverLabel: "github",
        serverUrl: "https://gitmcp.io/Azure/azure-rest-api-specs",
        allowedTools: ["search_azure_rest_api_code"], // Optional: specify allowed tools
    });
    // You can also add or remove allowed tools dynamically

    toolSet.addMCPTool({
        serverLabel: "microsoft_learn",
        serverUrl: "https://learn.microsoft.com/api/mcp",
        allowedTools: ["microsoft_docs_search"], // Optional: specify allowed tools
    });

    // Create agent with MCP tool
    const agent = await client.createAgent(modelDeploymentName, {
        // name formated as YYYY-MM-DD-HH-mm
        name: `teams-agent-${new Date().toISOString().replace(/[:.]/g, '-')}`,
        instructions:
            "You are a helpful agent that can use MCP tools to assist users. Use the available MCP tools to answer questions and perform tasks.",
        // tools: mcpTools.map((tool) => tool.definition),
        tools: toolSet.toolDefinitions,
    });
    console.log(`Created agent, agent ID : ${agent.id}`);
    state.conversation.agentId = agent.id;
    state.conversation.toolSet = toolSet;
}

// Welcome message when a new member is added to the conversation
// using this to signal the initial start of the bot
agentApp.onConversationUpdate('membersAdded', async (context: TurnContext, state: ApplicationTurnState) => {
    await initializeAIFoundryAgent(context, state);
    await context.sendActivity('Hello from the Teams MCP Client running Agents SDK version: ' + version, "", "Please summarize the Azure REST API specifications Readme and Give me the Azure CLI commands to create an Azure Container App with a managed identity");
    //await status(context, state)
})

const removeFoundryAgent = async (context: TurnContext, state: ApplicationTurnState) => {
    const agentId = state.conversation.agentId;
    if (!agentId) {
        console.log('No agent ID found, skipping removal');
        return;
    }

    const projectEndpoint = String(process.env['AI_FOUNDRY_ENDPOINT']);
    const client = new AgentsClient(projectEndpoint, new DefaultAzureCredential());

    try {
        await client.deleteAgent(agentId);
        console.log(`Deleted agent, agent ID : ${agentId}`);
    } catch (error) {
        console.error(`Failed to delete agent, agent ID : ${agentId}`, error);
    }
}

agentApp.onConversationUpdate('membersRemoved', async (context: TurnContext, state: ApplicationTurnState) => {
    console.log('Member removed from conversation, cleaning up any associated agent')
    await removeFoundryAgent(context, state);
})

agentApp.onActivity(ActivityTypes.EndOfConversation, async (context: TurnContext, state: ApplicationTurnState) => {
    console.log('End of conversation activity received, cleaning up any associated agent')
    await removeFoundryAgent(context, state);
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

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Generic message handler: increments count and echoes the user's message
agentApp.onActivity(ActivityTypes.Message, async (context: TurnContext, state: ApplicationTurnState) => {
    // Retrieve and increment the conversation message count
    let count = state.conversation.count ?? 0
    state.conversation.count = ++count

    const agentId = state.conversation.agentId;
    const projectEndpoint = String(process.env['AI_FOUNDRY_ENDPOINT']);
    const modelDeploymentName = String(process.env['AI_FOUNDRY_MODEL']);
    const client = new AgentsClient(projectEndpoint, new DefaultAzureCredential());

    if (!agentId) {
        await context.sendActivity('No agent found for this conversation. Please start a new conversation.')
        return;
    }

    const toolSet = state.conversation.toolSet;
    if (!toolSet) {
        await context.sendActivity('No toolset found for this conversation. Please start a new conversation.')
        return;
    }

    // Create thread for communication
    
    
    const thread = (state.conversation.threadId)
            ? await client.threads.get(state.conversation.threadId)
            : await client.threads.create();
        if (!thread) {
            // If thread retrieval/creation fails, log and notify user
            console.error("Failed to retrieve or create thread.");
            await context.sendActivity("Error: Unable to retrieve or create thread.");
        }
    console.log(`Using thread, thread ID: ${thread.id}`);
    state.conversation.threadId = thread.id;

    // Create message to thread
    const message = await client.messages.create(
        thread.id,
        "user",
        `${context.activity.text}`,
    );
    console.log(`Created message, message ID: ${message.id}`);
    let run = await client.runs.create(thread.id, agentId, {
        toolResources: toolSet.toolResources,
    });
    console.log(`Created run, run ID: ${run.id}`);
    await context.streamingResponse.queueInformativeUpdate('starting process...')
    // Poll the run status
    while (
        run.status === "queued" ||
        run.status === "in_progress" ||
        run.status === "requires_action"
    ) {
        await sleep(1000);
        run = await client.runs.get(thread.id, run.id);

        if (
            run.status === "requires_action" &&
            run.requiredAction &&
            isOutputOfType<SubmitToolApprovalAction>(run.requiredAction, "submit_tool_approval")
        ) {
            const toolCalls = run.requiredAction.submitToolApproval.toolCalls;

            if (!toolCalls?.length) {
                console.log("No tool calls provided - cancelling run");
                await client.runs.cancel(thread.id, run.id);
                break;
            }

            const toolApprovals: ToolApproval[] = [];

            for (const toolCall of toolCalls) {
                console.log(`Approving tool call: ${JSON.stringify(toolCall)}`);
                if (isOutputOfType<RequiredMcpToolCall>(toolCall, "mcp")) {
                    toolApprovals.push({
                        toolCallId: toolCall.id,
                        approve: true,
                        headers: {
                            "SuperSecret": "123456"
                        },
                    });
                }
            }

            console.log(`Tool approvals: ${JSON.stringify(toolApprovals)}`);
            if (toolApprovals.length > 0) {
                await client.runs.submitToolOutputs(thread.id, run.id, [], {
                    toolApprovals: toolApprovals,
                });
            }
        }
    }

    console.log(`Current run status: ${run.status}`);
    if (run.status === "failed") {
        console.log(`Run failed: ${JSON.stringify(run.lastError)}`);
    }

    // Display run steps and tool calls
    const runStepsIterator = client.runSteps.list(thread.id, run.id);
    console.log("\nRun Steps:");

    for await (const step of runStepsIterator) {
        console.log(`Step ${step.id} status: ${step.status}`);

        // Check if there are tool calls in the step details
        if (isOutputOfType<RunStepToolCallDetails>(step.stepDetails, "tool_calls")) {
            const toolCalls = step.stepDetails.toolCalls;

            console.log("  MCP Tool calls:");
            for (const call of toolCalls) {
                console.log(`Tool Call ID: ${call.id}`);
                console.log(`Type: ${call.type}`);
            }
        }
    }

    context.streamingResponse.setFeedbackLoop(true)
    context.streamingResponse.setGeneratedByAILabel(true)
    // Fetch and log all messages
    console.log("\nConversation:");
    console.log("-".repeat(50));

    const messagesIterator = client.messages.list(thread.id);
    const messages: ThreadMessage[] = [];

    for await (const msg of messagesIterator) {
        messages.unshift(msg); // Add to beginning to maintain chronological order
    }

    for (const msg of messages) {
        const messageContent: MessageContent = msg.content[0];
        if (isOutputOfType<MessageTextContent>(messageContent, "text")) {
            console.log(`${msg.role.toUpperCase()}: ${messageContent.text.value}`);
            await context.streamingResponse.queueTextChunk(messageContent.text.value + "\n")
            console.log("-".repeat(50));
        }
    }

    //await context.sendActivity(`[${count}] echoing: ${context.activity.text}`)
})