import { CACHE_MANAGER, CacheInterceptor } from "@nestjs/cache-manager";
import {
    CallHandler,
    ExecutionContext,
    Inject,
    Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Cache } from "cache-manager";
import type { Observable } from "rxjs";

@Injectable()
export class NodeOverviewCacheInterceptor extends CacheInterceptor {
  constructor(
    @Inject(CACHE_MANAGER) cacheManager: Cache,
    reflector: Reflector,
  ) {
    super(cacheManager, reflector);
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const response = http.getResponse();

    const key = this.trackBy(context);
    if (!key) {
      response?.setHeader?.("X-Cache-Status", "BYPASS");
      return super.intercept(context, next);
    }

    const cached = await this.cacheManager.get(key);
    response?.setHeader?.(
      "X-Cache-Status",
      cached === undefined ? "MISS" : "HIT",
    );

    return super.intercept(context, next);
  }
}
