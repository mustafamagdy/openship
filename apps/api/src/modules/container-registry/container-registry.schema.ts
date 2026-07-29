import { Type } from "@sinclair/typebox";

export const ConnectContainerRegistryBody = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 63 })),
  provider: Type.Optional(Type.Union([Type.Literal("ghcr"), Type.Literal("generic")])),
  registryHost: Type.String({ minLength: 3, maxLength: 255 }),
  namespace: Type.String({ minLength: 1, maxLength: 255 }),
  username: Type.String({ minLength: 1, maxLength: 255 }),
  token: Type.String({ minLength: 1, maxLength: 4096 }),
});
