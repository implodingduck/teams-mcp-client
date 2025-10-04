# Teams MCP Client

A Microsoft Teams bot and M365 Copilot agent that bridges Teams/Copilot conversations with Model Context Protocol (MCP) servers through Azure AI Foundry. This application enables Teams/Copilot users to interact with various MCP tools and services directly from their Teams/Copilot interface.

## Architecture Overview

The Teams MCP Client is built as a conversational agent that:

1. **Receives messages** from Microsoft Teams users
2. **Authenticates users** using Microsoft Graph and Azure AD
3. **Connects to MCP servers** configured in Cosmos DB
4. **Processes requests** through Azure AI Foundry (GPT-4o)
5. **Returns responses** with MCP tool outputs back to Teams

### Key Components

- **Teams Bot Framework**: Handles Teams messaging and authentication
- **Azure AI Foundry**: Provides AI processing capabilities with GPT-4o
- **Cosmos DB**: Stores MCP server configurations and allowed tools
- **Azure Container Apps**: Hosts the bot application
- **Microsoft Graph**: Handles user authentication and profile access

## Infrastructure Components

### Azure Resources

- **Azure Container Apps Environment**: Hosts the bot application with consumption-based scaling
- **Azure AI Foundry**: Cognitive Services account with GPT-4o deployment
- **Cosmos DB**: Serverless NoSQL database for MCP configurations
- **Key Vault**: Secure storage for secrets and certificates
- **Virtual Network**: Private networking with subnets and DNS zones
- **Application Insights**: Monitoring and telemetry
- **Managed Identity**: Azure AD authentication for services

### Networking

- Private DNS zones for `privatelink.cognitiveservices.azure.com`, `privatelink.services.ai.azure.com`, and `privatelink.openai.azure.com`
- Virtual network integration with dedicated subnets
- Private endpoints for Cosmos DB and cognitive services
- Network Security Groups for traffic control

## Key Dependencies

### Core Dependencies

- **`@azure/ai-agents`** (^1.2.0-beta.1): Azure AI Agents SDK for conversational AI
- **`@azure/ai-projects`** (^1.0.0-beta.10): Azure AI Projects client for AI Foundry integration
- **`@azure/cosmos`** (^4.5.1): Cosmos DB SDK for MCP server configuration storage
- **`@azure/identity`** (^4.10.2): Azure authentication and managed identity
- **`@microsoft/agents-hosting`** (^1.0.15): Microsoft Teams bot framework and hosting
- **`express`** (^5.1.0): Web server framework

### Development Dependencies

- **TypeScript** (^5.8.3): Type-safe JavaScript development
- **`@microsoft/m365agentsplayground`** (^0.2.16): Testing playground for M365 agents
- **`npm-run-all`** (^4.1.5): Parallel script execution

## Data Models

### MCP Server Configuration

```typescript
interface MCPServer {
    serverLabel: string;     // Friendly name for the server
    serverUrl: string;       // HTTP endpoint for the MCP server
    allowedTools: string[];  // Array of permitted tool names
}

interface MCPServersDocument {
    id: string;              // Document identifier
    servers: MCPServer[];    // Array of MCP server configurations
}
```

## Environment Setup

### Required Environment Variables

- `TENANT_ID` / `tenantId`: Azure AD tenant ID
- `CLIENT_ID` / `clientId`: Application client ID for Teams
- `AZURE_CLIENT_ID`: Managed identity client ID
- `AI_FOUNDRY_ENDPOINT`: AI Foundry service endpoint
- `AI_FOUNDRY_MODEL`: AI model deployment name (gpt-4o)
- `AI_FOUNDRY_CLIENT_ID`: AI Foundry authentication client ID
- `COSMOS_ENDPOINT`: Cosmos DB account endpoint
- `COSMOS_DB`: Cosmos DB database name
- `MCP_LABBY_KEY`: API key for MCP Labby service
- `graph_connectionName`: Graph connection name for authentication

### Local Development

1. Copy environment configuration:
   ```bash
   cp teamsbot/env.sample teamsbot/.env
   cp appPackage/env.sample appPackage/.env
   cp terraform/env.sample terraform/.env
   ```

2. Install dependencies:
   ```bash
   cd teamsbot
   npm install
   ```

3. Build and run:
   ```bash
   npm run build
   npm start
   ```

## Deployment

### Terraform Infrastructure

The infrastructure is defined in Terraform with the following components:

- **Resource Group**: Container for all Azure resources
- **Virtual Network**: Private networking with subnets
- **Container Apps Environment**: Hosting environment for the bot
- **AI Foundry**: Cognitive services with GPT-4o deployment
- **Cosmos DB**: Database for MCP server configurations
- **Key Vault**: Secure secret storage
- **Application Registration**: Azure AD app for Teams integration

Deploy using:

```bash
cd terraform
terraform init
terraform plan
terraform apply
```

### Container Deployment

The application is containerized and deployed to Azure Container Apps:

- **Image**: `ghcr.io/implodingduck/teams-mcp-client:latest`
- **Scaling**: HTTP-based auto-scaling (1-1 replicas)
- **Resources**: 0.25 CPU, 0.5Gi memory
- **Port**: 3978 (Teams Bot Framework endpoint)

### Teams App Package

The Teams app manifest is configured for:

- **Bot Integration**: Custom engine agent with personal and team scopes
- **Authentication**: Microsoft Graph integration
- **Permissions**: Identity and team member messaging

Build and publish the Teams app:

```bash
cd appPackage
./publish.sh
```

## Usage

### Teams Commands

- `/status`: Check authentication status
- `/me`: Get user profile information via Microsoft Graph
- `/reset`: Clear conversation state
- `/diag`: Display diagnostic information

### MCP Integration

The bot automatically connects to configured MCP servers and provides access to their tools through natural language conversations. MCP server configurations are stored in Cosmos DB and can include tools for various external services and APIs.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

