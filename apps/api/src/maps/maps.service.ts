import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { MapEntity } from "../entities/map.entity";

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
    const existing = input.id
      ? await this.mapsRepository.findOne({ where: { id: input.id, orgId: input.orgId } })
      : null;

    if (existing) {
      existing.name = input.name;
      existing.jsonConfig = input.jsonConfig;
      return this.mapsRepository.save(existing);
    }

    const created = this.mapsRepository.create({
      id: input.id ?? randomUUID(),
      orgId: input.orgId,
      name: input.name,
      jsonConfig: input.jsonConfig,
    });
    return this.mapsRepository.save(created);
  }
}
