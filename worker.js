// BUNA BINGO - Cloudflare deployment
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({
        name: "BUNA BINGO",
        status: "online"
      });
    }

    if (url.pathname === "/api/room") {
      const id = env.BINGO_ROOM.idFromName("main");
      return env.BINGO_ROOM.get(id).fetch(request);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }
};

export class BingoRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch() {
    return Response.json({
      success: true,
      room: "BUNA BINGO",
      maxPlayers: 500,
      maxCardsPerPlayer: 4,
      cardPrice: 10,
      prizePercentage: 60
    });
  }
}
