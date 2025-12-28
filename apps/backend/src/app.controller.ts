import { Controller, Get } from "@nestjs/common";
import { AppService } from "./app.service";
import { Public } from "./auth/public.decorator";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get("health")
  @Public()
  getHealth() {
    return { status: "ok" };
  }
}
