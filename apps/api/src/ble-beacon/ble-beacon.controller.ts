import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import type { BleBeaconStatus, BleTagConnection, BleTagRegistrationPayload, BleProximityReportPayload } from "@ignara/sharedtypes";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { BleBeaconService } from "./ble-beacon.service";

@Controller("ble-beacon")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin", "manager")
export class BleBeaconController {
  constructor(private readonly bleBeaconService: BleBeaconService) {}

  @Get("status")
  getStatus(): BleBeaconStatus | null {
    return this.bleBeaconService.getStatus();
  }

  @Get("tags")
  getConnectedTags(): BleTagConnection[] {
    return this.bleBeaconService.getConnectedTags();
  }

  // Simulation endpoints for testing without real BLE hardware
  @Post("simulate/tag")
  simulateTagRegistration(@Body() payload: BleTagRegistrationPayload): { ok: boolean } {
    this.bleBeaconService.simulateTagRegistration(payload);
    return { ok: true };
  }

  @Post("simulate/proximity")
  simulateProximityReport(@Body() payload: BleProximityReportPayload): { ok: boolean } {
    this.bleBeaconService.simulateProximityReport(payload);
    return { ok: true };
  }
}
