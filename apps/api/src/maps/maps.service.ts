import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { MapEntity } from "../entities/map.entity";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

@Injectable()
export class MapsService {
  constructor(
    @InjectRepository(MapEntity)
    private readonly mapsRepository: Repository<MapEntity>,
  ) {}

  listByOrg(orgId: string) {
    return this.mapsRepository.find({ where: { orgId } });
  }

  async getById(orgId: string, id: string) {
    const map = await this.mapsRepository.findOne({ where: { id, orgId } });
    if (!map) {
      throw new NotFoundException("Map not found");
    }
    return map;
  }

  async upsertMap(input: {
    id?: string;
    orgId: string;
    name: string;
    jsonConfig: Record<string, unknown>;
  }) {
    const normalizedId = input.id?.trim();
    const safeId = normalizedId && isUuid(normalizedId) ? normalizedId : undefined;

    const existing = safeId
      ? await this.mapsRepository.findOne({ where: { id: safeId, orgId: input.orgId } })
      : null;

    if (existing) {
      existing.name = input.name;
      existing.jsonConfig = input.jsonConfig;
      return this.mapsRepository.save(existing);
    }

    const created = this.mapsRepository.create({
      id: safeId ?? randomUUID(),
      orgId: input.orgId,
      name: input.name,
      jsonConfig: input.jsonConfig,
    });
    return this.mapsRepository.save(created);
  }
}
