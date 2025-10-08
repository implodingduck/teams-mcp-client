
// Import necessary classes and types from the Agents SDK
import { TurnState, MemoryStorage, TurnContext, AgentApplication, AttachmentDownloader, MessageFactory }
    from '@microsoft/agents-hosting'
import { version } from '@microsoft/agents-hosting/package.json'
import { ActivityTypes } from '@microsoft/agents-activity'
import {
    MessageContent,
    MessageTextContent,
    SubmitToolApprovalAction,
    RequiredMcpToolCall,
    ThreadMessage,
    ToolApproval,
    RunStepToolCallDetails,
    DoneEvent,
    ErrorEvent,
    MessageStreamEvent,
    RunStreamEvent,
    RunStepStreamEvent,
    type ThreadRun,
    type MessageDeltaChunk,
    type MessageDeltaTextContent,
    AgentEventMessageStream,
} from "@azure/ai-agents";
import { AgentsClient, ToolSet, isOutputOfType } from "@azure/ai-agents";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import { Container, CosmosClient, Database, FeedResponse, ItemResponse, SqlQuerySpec } from '@azure/cosmos';
import { stat } from 'fs';
import { asyncWrapProviders } from 'async_hooks';
import { MCPServer, MCPServersDocument } from './models';
import { threadMessageArrayDeserializer } from '@azure/ai-agents/dist/commonjs/models/models';

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

const queryCosmosDB = async (id: string): Promise<MCPServersDocument | null> => {
    const cosmosEndpoint = process.env['COSMOS_ENDPOINT'] as string;
    const cosmosDb = process.env['COSMOS_DB'] as string;
    console.log(`Trying to connect to Cosmos DB at ${cosmosEndpoint}, database ${cosmosDb}`);
    try {
        const credential = new DefaultAzureCredential();

        const client = new CosmosClient({
            endpoint: cosmosEndpoint,
            aadCredentials: credential
        });
        const database = client.database(cosmosDb);
        const container = database.container('mcpconfigs');
        if (id) {
            console.log("Trying to read item with id: " + id);
            const querySpec: SqlQuerySpec = {
                query: "SELECT * FROM c WHERE c.id = @id",
                parameters: [
                    {
                        name: "@id",
                        value: id
                    }
                ]
            };
            const { resources }: FeedResponse<MCPServersDocument> = await container.items.query<MCPServersDocument>(querySpec).fetchAll();
            if (resources.length > 0) {
                const readItem: MCPServersDocument = resources[0];
                console.log(`Cosmos DB read response resource: ${JSON.stringify(readItem)}`);
                return readItem;
            } else {
                console.log(`No item found with id: ${id}`);
            }
        }
    } catch (error) {
        console.error(`Error connecting to Cosmos DB: ${error}`);

    }
    return null;

}

const updateCosmosDB = async (item: MCPServersDocument): Promise<void> => {
    const cosmosEndpoint = process.env['COSMOS_ENDPOINT'] as string;
    const cosmosDb = process.env['COSMOS_DB'] as string;
    console.log(`Trying to connect to Cosmos DB at ${cosmosEndpoint}, database ${cosmosDb}`);   
    try {
        const credential = new DefaultAzureCredential();

        const client = new CosmosClient({
            endpoint: cosmosEndpoint,
            aadCredentials: credential
        });
        const database = client.database(cosmosDb);
        const container = database.container('mcpconfigs');
        if (item && item.id) {
            console.log("Trying to upsert item with id: " + item.id);
            const { resource }: ItemResponse<MCPServersDocument> = await container.items.upsert<MCPServersDocument>(item);
            console.log(`Cosmos DB upsert response resource: ${JSON.stringify(resource)}`);
        }
    } catch (error) {
        console.error(`Error connecting to Cosmos DB: ${error}`);

    }
}

const initalizeToolSet = async (context: TurnContext, state: ApplicationTurnState): Promise<ToolSet> => {

    const toolSet = new ToolSet();

    const readItem = await queryCosmosDB(context.activity.from?.aadObjectId as string);
    if (!readItem) {
        await context.sendActivity('No MCP server configurations found for this user in Cosmos DB.');
        return toolSet;
    }

    for (const server of readItem.servers) {
        toolSet.addMCPTool({
            serverLabel: server.serverLabel,
            serverUrl: server.serverUrl,
            allowedTools: server.allowedTools, // Optional: specify allowed tools
        });
    }

    state.conversation.toolSet = toolSet;

    return toolSet;
}

const initializeAIFoundryAgent = async (context: TurnContext, state: ApplicationTurnState) => {
    const projectEndpoint = String(process.env['AI_FOUNDRY_ENDPOINT']);
    const modelDeploymentName = String(process.env['AI_FOUNDRY_MODEL']);
    const client = new AgentsClient(projectEndpoint, new DefaultAzureCredential());

    const toolSet = await initalizeToolSet(context, state);
    try {
        console.log(`attempting to create agent with tools: ${JSON.stringify(toolSet.toolDefinitions)}`);
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
        return { agentId: agent.id, toolSet: toolSet };
    } catch (error) {
        console.error('Failed to create agent', error);
        await context.sendActivity('Error: Unable to create agent. Please try again later.');
        return { agentId: undefined, toolSet: toolSet };
    }
}

// Welcome message when a new member is added to the conversation
// using this to signal the initial start of the bot
agentApp.onConversationUpdate('membersAdded', async (context: TurnContext, state: ApplicationTurnState) => {
    //await context.sendActivity(MessageFactory.suggestedActions(["Please summarize the Azure REST API specifications Readme and Give me the Azure CLI commands to create an Azure Container App with a managed identity"], 'Hello from the Teams MCP Client running Agents SDK version: ' + version ));
    //await status(context, state)
    console.log('Member added to conversation...')
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
        state.conversation.agentId = undefined;
        state.conversation.threadId = undefined;
        state.conversation.toolSet = undefined;
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

// Handler for message who starts with #mcp
agentApp.onMessage(/^#mcp/, async (context: TurnContext, state: ApplicationTurnState) => {
    const inputTextArr = context.activity?.text?.split(' ')
    if (!inputTextArr || inputTextArr.length < 2) {
        await context.sendActivity('Usage: #mcp command, for example: #mcp help')
    } else if (inputTextArr.length >= 2) {
        switch (inputTextArr[1]) {
            case 'list':
                const readmItem = await queryCosmosDB(context.activity.from?.aadObjectId as string);
                if (!readmItem) {
                    await context.sendActivity('No MCP server configurations found for this user in Cosmos DB.');
                    return;
                }
                
                await context.sendActivity(`MCP Servers configured for you:\n\n\`\`\`json\n${JSON.stringify(readmItem.servers, null, 2)}\n\`\`\``);
                break;
            case 'edit':
                let textToEdit = inputTextArr.slice(2).join(' ');
                if (!textToEdit || textToEdit.length === 0) {
                    await context.sendActivity('Usage: #mcp edit [{},{},...], where the array is the full array of MCPServer objects to store in Cosmos DB');
                    return;
                }
                let updateJson = JSON.parse(textToEdit) as MCPServer[];
                if (!updateJson || updateJson.length === 0) {
                    await context.sendActivity('No valid JSON array of MCPServer objects found in input.');
                    return;
                }
                
                let isValid = true;
                updateJson.map((server) => {
                    if (!server.serverLabel || !server.serverUrl) {
                        isValid = false;
                    }
                    if (!server.serverLabel.match(/^[a-zA-Z0-9_]+$/)) {
                        isValid = false;
                    }
                });
                if (!isValid) {
                    await context.sendActivity('Invalid MCPServer object found in input. Ensure each object has a serverLabel and serverUrl, and that serverLabel contains only letters, numbers, and underscores.');
                    return;
                }
                const newDoc: MCPServersDocument = {
                    id: context.activity.from?.aadObjectId as string,
                    servers: updateJson
                };
                await updateCosmosDB(newDoc);
                await context.sendActivity('MCP server configurations updated successfully.');
                await removeFoundryAgent(context, state);
                break;
            case 'help':
                await context.sendActivity(`Available commands:\n\n- #mcp help: Show this help message\n- #mcp list: List MCP server configurations associated with your user\n- #mcp edit: Edit MCP server configurations associated with your user. Usage: #mcp edit [{},{},...], where the array is the full array of MCPServer objects to store in Cosmos DB`);
                break;
            default:
                await context.sendActivity(`command not recognized. Usage: #mcp help`)
                break;
        }
    }
})

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const handleStreamingResponse = async (context: TurnContext, state: ApplicationTurnState, client: AgentsClient, streamEventMessages: AgentEventMessageStream) => {
    for await (const eventMessage of streamEventMessages) {
        
        switch (eventMessage.event) {
            case RunStreamEvent.ThreadRunCreated:
                {
                    const threadRun = eventMessage.data as ThreadRun;
                    console.log(`ThreadRun status: ${threadRun.status}`);
                }
                break;
            case MessageStreamEvent.ThreadMessageDelta:
                {
                    const messageDelta = eventMessage.data as MessageDeltaChunk;
                    if (messageDelta.delta && messageDelta.delta.content) {
                        messageDelta.delta.content.forEach(async (contentPart) => {
                            if (contentPart.type === "text") {
                                const textContent = contentPart as MessageDeltaTextContent;
                                const textValue = textContent.text?.value;
                                if (textValue && textValue.length > 0) {
                                    //console.log(`Text delta received:: ${textValue}`);
                                    await context.streamingResponse.queueTextChunk(textValue);
                                    await sleep(500); // slight delay to help ordering
                                }
                            }
                        });
                    }
                }
                break;
            case RunStepStreamEvent.ThreadRunStepDelta:
                const tr = eventMessage.data as ThreadRun;
                console.log(`Thread Run Step Delta: ${JSON.stringify(tr)}`);
                break;
            case RunStreamEvent.ThreadRunRequiresAction:
                const threadRun = eventMessage.data as ThreadRun;
                console.log(`Thread Run Required Action: ${JSON.stringify(threadRun)}`);
                if (threadRun.requiredAction && isOutputOfType<SubmitToolApprovalAction>(threadRun.requiredAction, "submit_tool_approval")) {
                    // Handle the submit_tool_approval action
                    const toolApprovals: ToolApproval[] = [];
                    const toolCalls = threadRun.requiredAction.submitToolApproval.toolCalls;
                    for (const toolCall of toolCalls) {
                        console.log(`Approving tool call: ${JSON.stringify(toolCall)}`);
                        let headers: Record<string,string> = {
                            "SuperSecret": "123456"
                        }
                        if (isOutputOfType<RequiredMcpToolCall>(toolCall, "mcp")) {
                            if(toolCall.serverLabel === "labby"){
                                // TODO make this dynamic by looking up the serverLabel in cosmos db for this user
                                headers = {
                                    "Ocp-Apim-Subscription-Key": process.env['MCP_LABBY_KEY'] || "",
                                }
                            }
                            toolApprovals.push({
                                toolCallId: toolCall.id,
                                approve: true,
                                headers: headers,
                            });
                        }
                    }

                    console.log(`Tool approvals: ${JSON.stringify(toolApprovals)}`);
                    if (toolApprovals.length > 0) {
                        // Resubmit the tool approvals and continue streaming
                        let submitToolStream = await client.runs.submitToolOutputs(threadRun.threadId, threadRun.id, [], {
                            toolApprovals: toolApprovals,
                        }).stream();
                        // Recursively handle the new stream of events from submitting tool outputs
                        await handleStreamingResponse(context, state, client, submitToolStream);
                    }
                }
                break;
            case RunStreamEvent.ThreadRunCompleted:
                console.log("Thread Run Completed");
                break;
            case ErrorEvent.Error:
                console.log(`An error occurred. Data ${eventMessage.data}`);
                break;
            case DoneEvent.Done:
                console.log("Stream completed.");
                break;
            default:
                console.log(`Unknown event: ${eventMessage.event}`);
                break;
        }
    }
}

// Generic message handler: increments count and echoes the user's message
agentApp.onActivity(ActivityTypes.Message, async (context: TurnContext, state: ApplicationTurnState) => {
    // Retrieve and increment the conversation message count
    let count = state.conversation.count ?? 0
    state.conversation.count = ++count

    context.streamingResponse.setDelayInMs(500)
    context.streamingResponse.setFeedbackLoop(true)
    context.streamingResponse.setSensitivityLabel({ type: 'https://schema.org/Message', '@type': 'CreativeWork', name: 'Internal' })
    context.streamingResponse.setGeneratedByAILabel(true)

    await context.streamingResponse.queueInformativeUpdate('starting streaming response')

    let agentId = state.conversation.agentId;
    let toolSet = state.conversation.toolSet;
    if (!agentId) {
        console.log('No agent found for this conversation, creating one...')
        await context.streamingResponse.queueInformativeUpdate('No agent found for this conversation, creating one...')
        const initArr = await initializeAIFoundryAgent(context, state);
        agentId = initArr.agentId;
        toolSet = initArr.toolSet;
    }
    const projectEndpoint = String(process.env['AI_FOUNDRY_ENDPOINT']);
    const modelDeploymentName = String(process.env['AI_FOUNDRY_MODEL']);
    const client = new AgentsClient(projectEndpoint, new DefaultAzureCredential());

    if (!agentId) {
        await context.sendActivity('No agent found for this conversation. Please start a new conversation.')
        return;
    }


    if (!toolSet) {
        await context.sendActivity('No toolset found for this conversation. Please start a new conversation.')
        return;
    }

    // Create thread for communication
    await context.streamingResponse.queueInformativeUpdate('Starting thread...')

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

    // streaming return results
    await context.streamingResponse.queueInformativeUpdate('Running thread...')

    let streamEventMessages = await client.runs.create(thread.id, agentId, {
        toolResources: toolSet.toolResources,
    }).stream();

    await handleStreamingResponse(context, state, client, streamEventMessages);

    await context.streamingResponse.queueTextChunk("")
    await context.streamingResponse.endStream()
})