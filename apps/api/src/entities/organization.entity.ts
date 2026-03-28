import { Column, Entity, OneToMany, PrimaryColumn } from "typeorm";
import { UserEntity } from "./user.entity";

@Entity("organizations")
export class OrganizationEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 255, unique: true })
  name!: string;

  @OneToMany(() => UserEntity, (user) => user.organization)
  users!: UserEntity[];
}
