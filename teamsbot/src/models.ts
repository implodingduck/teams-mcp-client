/**
 * Represents a server configuration in the MCP servers collection
 */
export interface MCPServer {
    /**
     * Label identifier for the server
     */
    serverLabel: string;
    
    /**
     * URL endpoint for the server
     */
    serverUrl: string;
    
    /**
     * Array of allowed tools/operations for this server
     */
    allowedTools: string[];
}

/**
 * Represents a Cosmos DB document containing MCP server configurations
 */
export interface MCPServersDocument {
    /**
     * Unique identifier for the document
     */
    id: string;
    
    /**
     * Array of MCP server configurations
     */
    servers: MCPServer[];
}
