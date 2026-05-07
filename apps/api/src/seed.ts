import "reflect-metadata";
import { randomUUID } from "node:crypto";
import dataSource from "./typeorm.datasource";
import { hashPassword } from "./auth/password";
import { DeviceEntity } from "./entities/device.entity";
import { OrganizationEntity } from "./entities/organization.entity";
import { UserEntity } from "./entities/user.entity";

async function seed() {
  await dataSource.initialize();
  await dataSource.synchronize();

  const orgRepo = dataSource.getRepository(OrganizationEntity);
  const userRepo = dataSource.getRepository(UserEntity);
  const deviceRepo = dataSource.getRepository(DeviceEntity);

  let org = await orgRepo.findOne({ where: { name: "Ignara Demo Org" } });
  if (!org) {
    org = orgRepo.create({ id: randomUUID(), name: "Ignara Demo Org" });
    await orgRepo.save(org);
  }

  const seedUsers: Array<Partial<UserEntity>> = [
    {
      email: "admin@ignara.local",
      role: "admin",
      gender: "other",
      orgId: org.id,
      password: hashPassword("admin123"),
    },
    {
      email: "manager@ignara.local",
      role: "manager",
      gender: "male",
      orgId: org.id,
      password: hashPassword("manager123"),
    },
    {
      email: "employee@ignara.local",
      role: "employee",
      gender: "female",
      orgId: org.id,
      password: hashPassword("employee123"),
      tagDeviceId: "emp-001",
    },
    {
      email: "employee2@ignara.local",
      role: "employee",
      gender: "male",
      orgId: org.id,
      password: hashPassword("employee123"),
      tagDeviceId: "emp-002",
    },
  ];

  for (const candidate of seedUsers) {
    const exists = await userRepo.findOne({ where: { email: candidate.email } });
    if (!exists) {
      await userRepo.save(userRepo.create({ id: randomUUID(), ...candidate }));
      continue;
    }

    const nextGender = candidate.gender ?? exists.gender ?? "other";
    let dirty = false;
    if (exists.gender !== nextGender) {
      exists.gender = nextGender;
      dirty = true;
    }
    if (candidate.tagDeviceId !== undefined && exists.tagDeviceId !== candidate.tagDeviceId) {
      exists.tagDeviceId = candidate.tagDeviceId;
      dirty = true;
    }
    if (dirty) {
      await userRepo.save(exists);
    }
  }

  const seedDevices: Array<Partial<DeviceEntity>> = [
    { id: randomUUID(), deviceId: "tag-001", orgId: org.id, type: "tag", roomId: "room-A3" },
    { id: randomUUID(), deviceId: "tag-002", orgId: org.id, type: "tag", roomId: "room-B1" },
    { id: randomUUID(), deviceId: "scanner-01", orgId: org.id, type: "scanner", roomId: "room-A3" },
  ];

  for (const candidate of seedDevices) {
    const exists = await deviceRepo.findOne({ where: { deviceId: candidate.deviceId } });
    if (!exists) {
      await deviceRepo.save(deviceRepo.create(candidate));
    }
  }

  await dataSource.destroy();
}

seed().catch((error) => {
  console.error("Seed failed", error);
  process.exit(1);
});
