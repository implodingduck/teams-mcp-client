from os import environ
from microsoft_agents.hosting.core import AuthTypes, AgentAuthConfiguration


class DefaultConfig(AgentAuthConfiguration):
    """Teams Agent Configuration"""

    def __init__(self) -> None:
        self.AUTH_TYPE = AuthTypes.user_managed_identity 
        self.TENANT_ID = "" or environ.get(
            "TENANT_ID"
        )
        self.CLIENT_ID = "" or environ.get(
            "CLIENT_ID"
        )
        self.CONNECTION_NAME = "" or environ.get(
            "CONNECTION_NAME"
        )
        self.AGENT_TYPE = environ.get(
            "AGENT_TYPE", "TeamsHandler"
        )  # Default to TeamsHandler
        self.PORT = int(environ.get(
            "PORT", "3978"
        ))  # Default to 3978