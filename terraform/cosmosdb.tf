resource "azurerm_cosmosdb_account" "this" {
  name                = "cosmosdb-${local.func_name}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  offer_type          = "Standard"


  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = azurerm_resource_group.rg.location
    failover_priority = 0
  }

  capabilities {
    name = "EnableServerless"
  }

  tags = local.tags
  public_network_access_enabled = false
}

resource "azurerm_cosmosdb_sql_database" "this" {
  name                = "cosmosdb-${local.func_name}-db"
  resource_group_name = azurerm_resource_group.rg.name
  account_name        = azurerm_cosmosdb_account.this.name
}

resource "azurerm_cosmosdb_sql_container" "this" {
  name                  = "mcpconfigs"
  resource_group_name   = azurerm_resource_group.rg.name
  account_name          = azurerm_cosmosdb_account.this.name
  database_name         = azurerm_cosmosdb_sql_database.this.name
  partition_key_paths   = ["/id"]
  partition_key_version = 2
}

resource "azurerm_cosmosdb_sql_role_assignment" "this" {
  resource_group_name = azurerm_resource_group.rg.name
  account_name        = azurerm_cosmosdb_account.this.name
  role_definition_id  = "${azurerm_cosmosdb_account.this.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = azurerm_user_assigned_identity.this.principal_id
  scope               = azurerm_cosmosdb_account.this.id
}

# create a private endpoint for the cosmosdb account
resource "azurerm_private_endpoint" "this" {
  name                = "pe-cosmosdb-${local.func_name}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  subnet_id           = azurerm_subnet.pe.id
  private_service_connection {
    name                           = "psc-cosmosdb-${local.func_name}"
    private_connection_resource_id = azurerm_cosmosdb_account.this.id
    is_manual_connection           = false
    subresource_names              = ["Sql"]
  }
  private_dns_zone_group {
    name                 = "pdzg-cosmosdb-${local.func_name}"
    private_dns_zone_ids = [azurerm_private_dns_zone.documents.id]
  }

  tags = local.tags
}