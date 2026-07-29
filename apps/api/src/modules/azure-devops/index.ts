export { azureDevopsRoutes } from "./azure-devops.routes";

import { registerWebhookProvider } from "../webhooks/webhook.service";
import { azureDevopsWebhookProvider } from "./azure-devops.webhook";

registerWebhookProvider(azureDevopsWebhookProvider);
