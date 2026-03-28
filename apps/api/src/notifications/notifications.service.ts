import { Injectable } from "@nestjs/common";
import type { NotificationPayload } from "@ignara/sharedtypes";
import { InjectRepository } from "@nestjs/typeorm";
import mqtt, { MqttClient } from "mqtt";
import { Repository } from "typeorm";
import { randomUUID } from "node:crypto";
import { NotificationEntity } from "../entities/notification.entity";

@Injectable()
export class NotificationsService {
  private readonly mqttClient: MqttClient;

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationsRepository: Repository<NotificationEntity>,
  ) {
    this.mqttClient = mqtt.connect(process.env.MQTT_URL ?? "mqtt://localhost:1883");
  }

  listByOrg(orgId: string, limit = 50) {
    return this.notificationsRepository.find({
      where: { orgId },
      order: { createdAt: "DESC" },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  private async persistNotification(payload: NotificationPayload) {
    const created = this.notificationsRepository.create({
      id: randomUUID(),
      orgId: payload.orgId,
      senderId: payload.senderId,
      message: payload.message,
      priority: payload.priority,
      recipientIds: payload.recipientIds,
    });
    return this.notificationsRepository.save(created);
  }

  async sendTargeted(payload: NotificationPayload) {
    const recipients = payload.recipientIds ?? [];
    await Promise.all(
      recipients.map(
        (employeeId) =>
          new Promise<void>((resolve, reject) => {
            this.mqttClient.publish(
              `ignara/notifications/${employeeId}`,
              JSON.stringify(payload),
              (error) => (error ? reject(error) : resolve()),
            );
          }),
      ),
    );

    const notification = await this.persistNotification(payload);

    return { sent: recipients.length, notificationId: notification.id };
  }

  async sendBroadcast(payload: NotificationPayload) {
    await new Promise<void>((resolve, reject) => {
      this.mqttClient.publish(
        "ignara/notifications/broadcast",
        JSON.stringify(payload),
        (error) => (error ? reject(error) : resolve()),
      );
    });

    const notification = await this.persistNotification(payload);

    return { sent: "broadcast", notificationId: notification.id };
  }
}
