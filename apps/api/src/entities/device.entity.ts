import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity("devices")
export class DeviceEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 64, unique: true, name: "device_id" })
  deviceId!: string;

  @Column("uuid", { name: "org_id" })
  orgId!: string;

  @Column({ type: "varchar", length: 16 })
  type!: "tag" | "scanner";

  @Column({ type: "varchar", length: 64, nullable: true, name: "room_id" })
  roomId?: string | null;

  @Column({ type: "varchar", length: 128, nullable: true, name: "wifi_ssid" })
  wifiSsid?: string | null;

  @Column({ type: "varchar", length: 128, nullable: true, name: "wifi_password" })
  wifiPassword?: string | null;

  @Column({ type: "timestamptz", nullable: true, name: "wifi_updated_at" })
  wifiUpdatedAt?: Date | null;
}
