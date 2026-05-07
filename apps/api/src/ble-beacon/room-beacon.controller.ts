import { Body, Controller, Get, Headers, HttpException, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import type {
  RoomBeaconNotification,
  RoomBeaconNotifyRequest,
  RoomBeaconPollResponse,
  RoomBeaconReportPayload,
} from "@ignara/sharedtypes";
import { ConfigService } from "@nestjs/config";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { BleBeaconService } from "./ble-beacon.service";

@Controller("ble-beacon")
export class RoomBeaconController {
  constructor(
    private readonly bleBeaconService: BleBeaconService,
    private readonly configService: ConfigService,
  ) {}

  // ---- Device-facing (ESP32) endpoints. Authenticated with a shared device token. ----

  @Post("report")
  ingestReport(
    @Body() payload: RoomBeaconReportPayload,
    @Headers("x-device-token") deviceToken?: string,
  ): { ok: true } {
    this.assertDeviceToken(deviceToken);
    this.bleBeaconService.ingestRoomBeaconReport(payload);
    return { ok: true };
  }

  @Get("notifications/:beaconDeviceId")
  pollNotifications(
    @Param("beaconDeviceId") beaconDeviceId: string,
    @Headers("x-device-token") deviceToken?: string,
  ): RoomBeaconPollResponse {
    this.assertDeviceToken(deviceToken);
    const pending = this.bleBeaconService.popPendingNotifications(beaconDeviceId);
    return { beaconDeviceId, pending };
  }

  // ---- Admin/manager-facing endpoint to push a notification down to all room beacons. ----

  @Post("notifications/broadcast")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin", "manager")
  broadcast(@Body() payload: RoomBeaconNotifyRequest): RoomBeaconNotification {
    return this.bleBeaconService.queueNotification(payload);
  }

  private assertDeviceToken(deviceToken: string | undefined) {
    const expected = this.configService.get<string>("ROOM_BEACON_DEVICE_TOKEN", "");
    if (!expected) {
      // Token check disabled by server config — allow for local dev.
      return;
    }
    if (deviceToken !== expected) {
      throw new HttpException("Invalid device token", HttpStatus.UNAUTHORIZED);
    }
  }
}
