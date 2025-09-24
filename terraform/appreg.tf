
resource "azuread_application" "teams-mcp-client-graph" {
  display_name = "teams-mcp-client-graph"
  owners       = [data.azurerm_client_config.current.object_id]
  sign_in_audience = "AzureADMyOrg"
  identifier_uris = ["api://botid-${azurerm_user_assigned_identity.bot.client_id}"]

  api {
    requested_access_token_version = 2
    oauth2_permission_scope {
      id = random_uuid.access_as_user.result
      admin_consent_description = "Allows Teams to call the app's web APIs as the current user."
      admin_consent_display_name = "Teams can access app's web APIs"
      user_consent_display_name = "Teams can access app's web APIs and make requests on your behalf"
      user_consent_description = "Enable Teams to call this app's web APIs with the same rights that you have"
      enabled = true
      type = "User"
      value = "access_as_user"      
    }
  }

  required_resource_access {
    resource_app_id = "00000003-0000-0000-c000-000000000000" # Microsoft Graph

    resource_access {
      id   = "e1fe6dd8-ba31-4d61-89e7-88639da4683d" # User.Read
      type = "Scope"
    }
  }

  web {
    redirect_uris = ["https://token.botframework.com/.auth/web/redirect"]
  }
}

resource "azuread_application_password" "this" {
  application_id = azuread_application.teams-mcp-client-graph.id
  display_name   = "terraform-${random_string.unique.result}"
  end_date       = timeadd(timestamp(), "720h") # 30 days
  lifecycle {
    ignore_changes = [end_date]
  }
}

resource "azuread_application_pre_authorized" "teamsbot-aca-1fec8e78-bce4-4aaf-ab1b-5451cc387264" {
    application_id = azuread_application.teams-mcp-client-graph.id
    authorized_client_id = "1fec8e78-bce4-4aaf-ab1b-5451cc387264"

    permission_ids = [
        random_uuid.access_as_user.result
    ]
}

resource "azuread_application_pre_authorized" "teamsbot-aca-5e3ce6c0-2b1f-4285-8d4b-75ee78787346" {
    application_id = azuread_application.teams-mcp-client-graph.id
    authorized_client_id = "5e3ce6c0-2b1f-4285-8d4b-75ee78787346"

    permission_ids = [
        random_uuid.access_as_user.result
    ]
}

resource "azuread_application_pre_authorized" "teamsbot-aca-d3590ed6-52b3-4102-aeff-aad2292ab01c" {
    application_id = azuread_application.teams-mcp-client-graph.id
    authorized_client_id = "d3590ed6-52b3-4102-aeff-aad2292ab01c"

    permission_ids = [
        random_uuid.access_as_user.result
    ]
}

resource "azuread_application_pre_authorized" "teamsbot-aca-00000002-0000-0ff1-ce00-000000000000" {
    application_id = azuread_application.teams-mcp-client-graph.id
    authorized_client_id = "00000002-0000-0ff1-ce00-000000000000"

    permission_ids = [
        random_uuid.access_as_user.result
    ]
}

resource "azuread_application_pre_authorized" "teamsbot-aca-bc59ab01-8403-45c6-8796-ac3ef710b3e3" {
    application_id = azuread_application.teams-mcp-client-graph.id
    authorized_client_id = "bc59ab01-8403-45c6-8796-ac3ef710b3e3"

    permission_ids = [
        random_uuid.access_as_user.result
    ]
}

resource "azuread_application_pre_authorized" "teamsbot-aca-0ec893e0-5785-4de6-99da-4ed124e5296c" {
    application_id = azuread_application.teams-mcp-client-graph.id
    authorized_client_id = "0ec893e0-5785-4de6-99da-4ed124e5296c"

    permission_ids = [
        random_uuid.access_as_user.result
    ]
}

resource "azuread_application_pre_authorized" "teamsbot-aca-4765445b-32c6-49b0-83e6-1d93765276ca" {
    application_id = azuread_application.teams-mcp-client-graph.id
    authorized_client_id = "4765445b-32c6-49b0-83e6-1d93765276ca"

    permission_ids = [
        random_uuid.access_as_user.result
    ]
}

resource "azuread_application_pre_authorized" "teamsbot-aca-4345a7b9-9a63-4910-a426-35363201d503" {
    application_id = azuread_application.teams-mcp-client-graph.id
    authorized_client_id = "4345a7b9-9a63-4910-a426-35363201d503"

    permission_ids = [
        random_uuid.access_as_user.result
    ]
}

resource "random_uuid" "access_as_user" {}