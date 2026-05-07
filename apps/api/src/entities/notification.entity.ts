import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

@Entity("notifications")
export class NotificationEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column("uuid", { name: "org_id" })
  orgId!: string;

  @Column("uuid", { name: "sender_id" })
  senderId!: string;

  @Column({ type: "text" })
  message!: string;

  @Column({ type: "varchar", length: 16, default: "normal" })
  priority!: "low" | "normal" | "high";

  @Column({ type: "simple-array", name: "recipient_ids", nullable: true })
  recipientIds?: string[];

  @CreateDateColumn({ type: "timestamptz", name: "created_at" })
  createdAt!: Date;
}
