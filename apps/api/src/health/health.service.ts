import { Injectable } from "@nestjs/common";
import Redis from "ioredis";
import mqtt from "mqtt";
import { DataSource } from "typeorm";

type CheckStatus = "ok" | "error";

@Injectable()
export class HealthService {
  constructor(private readonly dataSource: DataSource) {}

  async getHealth() {
    const startedAt = Date.now();
    const [database, redis, mqttBroker] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkMqtt(),
    ]);

    const checks = { database, redis, mqtt: mqttBroker };
    const ok = Object.values(checks).every((entry) => entry.status === "ok");

    return {
      status: ok ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      responseMs: Date.now() - startedAt,
      checks,
    };
  }

  private async checkDatabase(): Promise<{ status: CheckStatus; details?: string }> {
    try {
      await this.dataSource.query("SELECT 1");
      return { status: "ok" };
    } catch (error) {
      return { status: "error", details: String(error) };
    }
  }

  private async checkRedis(): Promise<{ status: CheckStatus; details?: string }> {
    const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

    try {
      await client.connect();
      await client.ping();
      return { status: "ok" };
    } catch (error) {
      return { status: "error", details: String(error) };
    } finally {
      client.disconnect();
    }
  }

  private async checkMqtt(): Promise<{ status: CheckStatus; details?: string }> {
    const mqttUrl = process.env.MQTT_URL ?? "mqtt://localhost:1883";
    const client = mqtt.connect(mqttUrl, {
      connectTimeout: 3000,
      reconnectPeriod: 0,
    });

    let timeoutHandle: NodeJS.Timeout | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("MQTT health check timeout")), 3500);
        client.once("connect", () => resolve());
        client.once("error", (error) => reject(error));
      });

      return { status: "ok" };
    } catch (error) {
      return { status: "error", details: String(error) };
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      client.end(true);
    }
  }
}