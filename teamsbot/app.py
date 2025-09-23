# app.py
from microsoft_agents.hosting.core import (
   AgentApplication,
   TurnState,
   TurnContext,
   MemoryStorage,
   RestChannelServiceClientFactory
)
from microsoft_agents.hosting.aiohttp import CloudAdapter
from microsoft_agents.hosting.core.authorization import (
    Connections,
    AccessTokenProviderBase,
    ClaimsIdentity,
)
from microsoft_agents.authentication.msal import MsalAuth
from start_server import start_server
from config import DefaultConfig

CONFIG = DefaultConfig()
AUTH_PROVIDER = MsalAuth(DefaultConfig())

class DefaultConnection(Connections):
    def get_default_connection(self) -> AccessTokenProviderBase:
        pass

    def get_token_provider(
        self, claims_identity: ClaimsIdentity, service_url: str
    ) -> AccessTokenProviderBase:
        return AUTH_PROVIDER

    def get_connection(self, connection_name: str) -> AccessTokenProviderBase:
        pass
    
    def get_default_connection_configuration(self):
        pass

CHANNEL_CLIENT_FACTORY = RestChannelServiceClientFactory(CONFIG, DefaultConnection())

ADAPTER = CloudAdapter(channel_service_client_factory=CHANNEL_CLIENT_FACTORY)


AGENT_APP = AgentApplication[TurnState](
    storage=MemoryStorage(), adapter=ADAPTER
)

async def _help(context: TurnContext, _: TurnState):
    await context.send_activity(
        "Welcome to the Echo Agent sample 🚀. "
        "Type /help for help or send a message to see the echo feature in action."
    )

AGENT_APP.conversation_update("membersAdded")(_help)

AGENT_APP.message("/help")(_help)


@AGENT_APP.activity("message")
async def on_message(context: TurnContext, _):
    await context.send_activity(f"you said: {context.activity.text}")

if __name__ == "__main__":
    try:
        start_server(AGENT_APP, CONFIG)
    except Exception as error:
        raise error