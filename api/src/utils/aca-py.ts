import { Application } from "@feathersjs/express";
import Axios, { AxiosRequestConfig } from "axios";
import logger from "../logger";
import { UndefinedAppError } from "../models/errors";
import { AriesSchema, SchemaDefinition } from "../models/schema";
import { CredDefUtils } from "./credential-definition";
import { loadJSON } from "./load-config-file";
import { SchemaUtils } from "./schema";
import { sleep } from "./sleep";

export class AcaPyUtils {
  static instance: AcaPyUtils;
  app: Application;

  private constructor(app: Application) {
    this.app = app;
  }

  static getInstance(app?: Application): AcaPyUtils {
    if (!this.instance) {
      if (!app) {
        throw new UndefinedAppError(
          "Error creating a new instance of [AcaPyUtils]: no app was provided"
        );
      }
      this.instance = new AcaPyUtils(app);
      logger.debug("Created new instance of [AcaPyUtils]");
    }
    return this.instance;
  }

  getRequestConfig(): AxiosRequestConfig {
    return {
      headers: {
        "x-api-key": this.app.get("agent").adminApiKey || "",
      },
    } as AxiosRequestConfig;
  }

  getAdminUrl(): string {
    return this.app.get("agent").adminUrl;
  }

  async processDefinition(schemaDef: SchemaDefinition) {}

  async init(): Promise<any> {
    const config = loadJSON("schemas.json") as SchemaDefinition[];
    const schemaUtils = SchemaUtils.getInstance(this.app);
    const credDefUtils = CredDefUtils.getInstance(this.app);

    // wait for the agent to be ready
    while (!(await this.isAgentReady())) {
      logger.debug("Agent not ready, retrying in 500ms...");
      await sleep(500);
    }

    // init schemas and cred_defs
    for (let schemaDef of config) {
      try {
        logger.debug(
          `Initializing schema/cred_def: ${JSON.stringify(schemaDef)}`
        );
        let schema: AriesSchema;
        if (schemaDef.id) {
          // Already published to ledger
          schema = await schemaUtils.fetchSchema(
            schemaDef.id,
            schemaDef.default
          );
        } else {
          // Register to the ledger
          schema = await schemaUtils.publishSchema(schemaDef);
        }
        const support_revocation = schemaDef.revocable || false;
        const tag = schemaDef.tag || "default";

        //  publish cred_def for current schema
        const credDef = credDefUtils.formatCredentialDefinition(
          schema.schema.id,
          support_revocation,
          tag
        );
        await credDefUtils.getOrCreateCredDef(credDef);
      } catch (err) {
        logger.error(err);
      }
    }

    if (!this.app.get("schemas").get("default")) {
      logger.warn(
        "No default schema set, all requests to the API will need to specify which schema to use"
      );
    }

    return new Promise(() => {
      return {
        schemas: this.app.get("schemas"),
        credDefs: this.app.get("credDefs"),
      };
    });
  }

  async isAgentReady(): Promise<boolean> {
    const url = `${this.app.get("agent").adminUrl}/status/ready`;
    let result;
    try {
      const response = await Axios.get(url, this.getRequestConfig());
      result = response.status === 200 ? true : false;
    } catch (error) {
      result = false;
    }
    return Promise.resolve(result);
  }
}
