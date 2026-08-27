import { ForumCommentStatus, ForumPostStatus, Prisma, PrismaClient } from "@prisma/client";
import { sensitiveWordService } from "./sensitiveWord.service";

const prisma = new PrismaClient();

const defaultCategories = [
  { code: "LOST_FOUND", name: "失物招领", icon: "🔎", sort_order: 10 },
  { code: "SECOND_HAND", name: "二手交易", icon: "🛍️", sort_order: 20 },
  { code: "CONFESSION", name: "表白墙", icon: "💌", sort_order: 30 },
  { code: "NOTICE", name: "校园通知", icon: "📢", sort_order: 40 },
  { code: "RIDE_SHARE", name: "拼车", icon: "🚗", sort_order: 50 },
] as const;

export class ForumError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const parseIntOr = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
  return fallback;
};

const parsePositiveId = (value: unknown, field: string) => {
  const id = parseIntOr(value, 0);
  if (id <= 0) throw new ForumError(400, `${field} 不合法`);
  return id;
};

const text = (value: unknown) => (value === undefined || value === null ? "" : String(value).trim());

const normalizeImages = (value: unknown) => {
  if (!Array.isArray(value)) return [] as string[];
  const images = value
    .map((item) => text(item))
    .filter((item) => item.length > 0 && item.length <= 500)
    .filter((item) => /^https?:\/\//i.test(item) || item.startsWith("/uploads/"));
  return Array.from(new Set(images)).slice(0, 9);
};

const imagesFromJson = (value: unknown) => (Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []);

const normalizeCoordinate = (value: unknown, min: number, max: number, field: string) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new ForumError(400, `${field} 不合法`);
  }
  return parsed;
};

const parsePostStatus = (value: unknown) => {
  const status = text(value).toUpperCase();
  if (!status) return undefined;
  if (!(Object.values(ForumPostStatus) as string[]).includes(status)) {
    throw new ForumError(400, "status 不合法");
  }
  return status as ForumPostStatus;
};

const visiblePostInclude = (viewerId: number) => ({
  author: { select: { id: true, nickname: true, avatar: true, credit_score: true } },
  category: { select: { id: true, code: true, name: true, icon: true } },
  _count: { select: { likes: true, favorites: true, comments: { where: { status: ForumCommentStatus.APPROVED } } } },
  likes: { where: { user_id: viewerId }, select: { id: true } },
  favorites: { where: { user_id: viewerId }, select: { id: true } },
});

const mapPost = (post: any, options: { showAudit?: boolean } = {}) => ({
  id: post.id,
  author_id: post.author_id,
  title: post.title,
  content: post.content,
  images: imagesFromJson(post.images_json),
  location_name: post.location_name,
  latitude: post.latitude,
  longitude: post.longitude,
  status: post.status,
  ...(options.showAudit ? { audit_note: post.audit_note, audited_at: post.audited_at } : {}),
  is_pinned: post.is_pinned,
  created_at: post.created_at,
  updated_at: post.updated_at,
  author: post.author,
  category: post.category,
  like_count: post._count?.likes ?? 0,
  favorite_count: post._count?.favorites ?? 0,
  comment_count: post._count?.comments ?? 0,
  is_liked: Array.isArray(post.likes) && post.likes.length > 0,
  is_favorited: Array.isArray(post.favorites) && post.favorites.length > 0,
});

const mapComment = (comment: any) => ({
  id: comment.id,
  post_id: comment.post_id,
  author_id: comment.author_id,
  content: comment.content,
  status: comment.status,
  created_at: comment.created_at,
  updated_at: comment.updated_at,
  author: comment.author,
});

const ensureDefaultCategories = async () => {
  await Promise.all(
    defaultCategories.map((category) =>
      prisma.forumCategory.upsert({
        where: { code: category.code },
        update: {},
        create: category,
      }),
    ),
  );
};

const ensureSensitiveTextIsSafe = async (value: string, field: string) => {
  const match = await sensitiveWordService.matchText(value);
  if (match.matched) throw new ForumError(400, `${field}包含敏感词，请修改后再提交`);
};

const getApprovedPost = async (postId: number) => {
  const post = await prisma.forumPost.findFirst({
    where: { id: postId, status: ForumPostStatus.APPROVED },
    select: { id: true },
  });
  if (!post) throw new ForumError(404, "信息不存在或暂不可见");
  return post;
};

export class ForumService {
  async listCategories(includeInactive = false) {
    await ensureDefaultCategories();
    return prisma.forumCategory.findMany({
      where: includeInactive ? undefined : { is_active: true },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
    });
  }

  async listPosts(input: {
    viewerId: number;
    page?: unknown;
    pageSize?: unknown;
    categoryId?: unknown;
    keyword?: unknown;
    sort?: unknown;
    mine?: unknown;
  }) {
    const page = Math.max(1, parseIntOr(input.page, 1));
    const pageSize = Math.min(50, Math.max(1, parseIntOr(input.pageSize, 10)));
    const categoryId = input.categoryId === undefined || input.categoryId === "" ? undefined : parsePositiveId(input.categoryId, "category_id");
    const keyword = text(input.keyword).slice(0, 60);
    const mine = input.mine === true || String(input.mine).toLowerCase() === "true" || String(input.mine) === "1";
    const sort = text(input.sort).toLowerCase() === "hot" ? "hot" : "latest";
    const where: Prisma.ForumPostWhereInput = {
      ...(categoryId ? { category_id: categoryId } : {}),
      ...(mine ? { author_id: input.viewerId, status: { not: ForumPostStatus.HIDDEN } } : { status: ForumPostStatus.APPROVED }),
      ...(keyword
        ? {
            OR: [
              { title: { contains: keyword } },
              { content: { contains: keyword } },
              { location_name: { contains: keyword } },
            ],
          }
        : {}),
    };
    const orderBy: any =
      sort === "hot"
        ? [{ is_pinned: "desc" }, { likes: { _count: "desc" } }, { comments: { _count: "desc" } }, { created_at: "desc" }]
        : [{ is_pinned: "desc" }, { created_at: "desc" }];

    const [total, posts] = await Promise.all([
      prisma.forumPost.count({ where }),
      prisma.forumPost.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: visiblePostInclude(input.viewerId),
      }),
    ]);

    return {
      page,
      page_size: pageSize,
      total,
      list: posts.map((post) => mapPost(post, { showAudit: mine })),
    };
  }

  async getPostDetail(input: { postId: number; viewerId: number; isAdmin?: boolean }) {
    const post = await prisma.forumPost.findUnique({
      where: { id: input.postId },
      include: visiblePostInclude(input.viewerId),
    });
    if (!post || post.status === ForumPostStatus.HIDDEN) throw new ForumError(404, "信息不存在");
    const canView = input.isAdmin || post.status === ForumPostStatus.APPROVED || post.author_id === input.viewerId;
    if (!canView) throw new ForumError(404, "信息正在审核中");

    const comments = await prisma.forumComment.findMany({
      where: {
        post_id: input.postId,
        ...(input.isAdmin ? {} : { status: ForumCommentStatus.APPROVED }),
      },
      orderBy: { created_at: "asc" },
      include: { author: { select: { id: true, nickname: true, avatar: true, credit_score: true } } },
    });

    return {
      post: mapPost(post, { showAudit: Boolean(input.isAdmin || post.author_id === input.viewerId) }),
      comments: comments.map(mapComment),
    };
  }

  async createPost(input: {
    authorId: number;
    categoryId: unknown;
    title: unknown;
    content: unknown;
    images?: unknown;
    locationName?: unknown;
    latitude?: unknown;
    longitude?: unknown;
  }) {
    await ensureDefaultCategories();
    const categoryId = parsePositiveId(input.categoryId, "分类");
    const title = text(input.title);
    const content = text(input.content);
    const locationName = text(input.locationName);
    const images = normalizeImages(input.images);
    const latitude = normalizeCoordinate(input.latitude, -90, 90, "纬度");
    const longitude = normalizeCoordinate(input.longitude, -180, 180, "经度");

    if (title.length < 2 || title.length > 100) throw new ForumError(400, "标题长度应为 2-100 个字符");
    if (content.length < 5 || content.length > 2000) throw new ForumError(400, "正文长度应为 5-2000 个字符");
    if (locationName.length > 120) throw new ForumError(400, "地点不能超过 120 个字符");
    if ((latitude === null) !== (longitude === null)) throw new ForumError(400, "请同时提供经纬度");

    await Promise.all([ensureSensitiveTextIsSafe(title, "标题"), ensureSensitiveTextIsSafe(content, "正文"), ensureSensitiveTextIsSafe(locationName, "地点")]);

    const category = await prisma.forumCategory.findFirst({ where: { id: categoryId, is_active: true }, select: { id: true } });
    if (!category) throw new ForumError(400, "所选分类已停用或不存在");

    const post = await prisma.forumPost.create({
      data: {
        author_id: input.authorId,
        category_id: category.id,
        title,
        content,
        images_json: images.length ? (images as Prisma.InputJsonValue) : Prisma.JsonNull,
        location_name: locationName || null,
        latitude,
        longitude,
        status: ForumPostStatus.PENDING,
      },
      include: visiblePostInclude(input.authorId),
    });
    return mapPost(post, { showAudit: true });
  }

  async hideOwnPost(input: { postId: number; authorId: number }) {
    const post = await prisma.forumPost.findUnique({ where: { id: input.postId }, select: { id: true, author_id: true } });
    if (!post) throw new ForumError(404, "信息不存在");
    if (post.author_id !== input.authorId) throw new ForumError(403, "无权删除该信息");
    await prisma.forumPost.update({ where: { id: post.id }, data: { status: ForumPostStatus.HIDDEN } });
  }

  async setLike(input: { postId: number; userId: number; liked: boolean }) {
    await getApprovedPost(input.postId);
    if (input.liked) {
      await prisma.forumPostLike.upsert({
        where: { post_id_user_id: { post_id: input.postId, user_id: input.userId } },
        update: {},
        create: { post_id: input.postId, user_id: input.userId },
      });
    } else {
      await prisma.forumPostLike.deleteMany({ where: { post_id: input.postId, user_id: input.userId } });
    }
    const likeCount = await prisma.forumPostLike.count({ where: { post_id: input.postId } });
    return { liked: input.liked, like_count: likeCount };
  }

  async setFavorite(input: { postId: number; userId: number; favorited: boolean }) {
    await getApprovedPost(input.postId);
    if (input.favorited) {
      await prisma.forumFavorite.upsert({
        where: { post_id_user_id: { post_id: input.postId, user_id: input.userId } },
        update: {},
        create: { post_id: input.postId, user_id: input.userId },
      });
    } else {
      await prisma.forumFavorite.deleteMany({ where: { post_id: input.postId, user_id: input.userId } });
    }
    const favoriteCount = await prisma.forumFavorite.count({ where: { post_id: input.postId } });
    return { favorited: input.favorited, favorite_count: favoriteCount };
  }

  async listFavorites(input: { userId: number; page?: unknown; pageSize?: unknown }) {
    const page = Math.max(1, parseIntOr(input.page, 1));
    const pageSize = Math.min(50, Math.max(1, parseIntOr(input.pageSize, 10)));
    const where: Prisma.ForumFavoriteWhereInput = { user_id: input.userId, post: { status: ForumPostStatus.APPROVED } };
    const [total, favorites] = await Promise.all([
      prisma.forumFavorite.count({ where }),
      prisma.forumFavorite.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { post: { include: visiblePostInclude(input.userId) } },
      }),
    ]);
    return { page, page_size: pageSize, total, list: favorites.map((favorite) => mapPost(favorite.post)) };
  }

  async createComment(input: { postId: number; authorId: number; content: unknown }) {
    await getApprovedPost(input.postId);
    const content = text(input.content);
    if (content.length < 1 || content.length > 300) throw new ForumError(400, "评论长度应为 1-300 个字符");
    await ensureSensitiveTextIsSafe(content, "评论");
    const comment = await prisma.forumComment.create({
      data: { post_id: input.postId, author_id: input.authorId, content },
      include: { author: { select: { id: true, nickname: true, avatar: true, credit_score: true } } },
    });
    return mapComment(comment);
  }

  async hideOwnComment(input: { commentId: number; authorId: number }) {
    const comment = await prisma.forumComment.findUnique({ where: { id: input.commentId }, select: { id: true, author_id: true } });
    if (!comment) throw new ForumError(404, "评论不存在");
    if (comment.author_id !== input.authorId) throw new ForumError(403, "无权删除该评论");
    await prisma.forumComment.update({ where: { id: comment.id }, data: { status: ForumCommentStatus.HIDDEN } });
  }

  async listAdminPosts(input: { page?: unknown; pageSize?: unknown; status?: unknown; categoryId?: unknown; keyword?: unknown }) {
    const page = Math.max(1, parseIntOr(input.page, 1));
    const pageSize = Math.min(100, Math.max(1, parseIntOr(input.pageSize, 20)));
    const status = parsePostStatus(input.status);
    const categoryId = input.categoryId === undefined || input.categoryId === "" ? undefined : parsePositiveId(input.categoryId, "category_id");
    const keyword = text(input.keyword).slice(0, 60);
    const where: Prisma.ForumPostWhereInput = {
      ...(status ? { status } : {}),
      ...(categoryId ? { category_id: categoryId } : {}),
      ...(keyword
        ? { OR: [{ title: { contains: keyword } }, { content: { contains: keyword } }, { author: { nickname: { contains: keyword } } }] }
        : {}),
    };
    const [total, posts] = await Promise.all([
      prisma.forumPost.count({ where }),
      prisma.forumPost.findMany({
        where,
        orderBy: [{ status: "asc" }, { created_at: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          ...visiblePostInclude(0),
          auditor: { select: { id: true, nickname: true } },
        },
      }),
    ]);
    return { page, page_size: pageSize, total, list: posts.map((post) => ({ ...mapPost(post, { showAudit: true }), auditor: post.auditor })) };
  }

  async auditPost(input: { postId: number; adminId: number; action: unknown; auditNote?: unknown; isPinned?: unknown }) {
    const action = text(input.action).toUpperCase();
    const statusByAction: Record<string, ForumPostStatus> = {
      APPROVE: ForumPostStatus.APPROVED,
      REJECT: ForumPostStatus.REJECTED,
      HIDE: ForumPostStatus.HIDDEN,
    };
    const status = statusByAction[action];
    if (!status) throw new ForumError(400, "action 必须为 approve、reject 或 hide");
    const auditNote = text(input.auditNote);
    if (auditNote.length > 300) throw new ForumError(400, "审核说明不能超过 300 个字符");
    if (status === ForumPostStatus.REJECTED && !auditNote) throw new ForumError(400, "驳回时请填写审核说明");
    const isPinned = input.isPinned === true || String(input.isPinned).toLowerCase() === "true" || String(input.isPinned) === "1";
    const post = await prisma.forumPost.findUnique({ where: { id: input.postId }, select: { id: true } });
    if (!post) throw new ForumError(404, "信息不存在");
    const now = new Date();
    await prisma.$transaction([
      prisma.forumPost.update({
        where: { id: post.id },
        data: { status, audit_note: auditNote || null, audited_by: input.adminId, audited_at: now, ...(status === ForumPostStatus.APPROVED ? { is_pinned: isPinned } : {}) },
      }),
      prisma.adminLog.create({
        data: {
          admin_id: input.adminId,
          action: "FORUM_POST_AUDIT",
          target_type: "FORUM_POST",
          target_id: post.id,
          detail_json: { action: action.toLowerCase(), audit_note: auditNote || null, at: now.toISOString() } as Prisma.InputJsonValue,
        },
      }),
    ]);
  }

  async createCategory(input: { code: unknown; name: unknown; icon?: unknown; sortOrder?: unknown }) {
    const code = text(input.code).toUpperCase();
    const name = text(input.name);
    const icon = text(input.icon);
    const sortOrder = parseIntOr(input.sortOrder, 0);
    if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) throw new ForumError(400, "分类编码应为 2-40 位大写字母、数字或下划线");
    if (!name || name.length > 40) throw new ForumError(400, "分类名称应为 1-40 个字符");
    if (icon.length > 16) throw new ForumError(400, "分类图标不能超过 16 个字符");
    try {
      return await prisma.forumCategory.create({ data: { code, name, icon: icon || null, sort_order: sortOrder, is_active: true } });
    } catch (error: any) {
      if (error?.code === "P2002") throw new ForumError(409, "分类编码已存在");
      throw error;
    }
  }

  async updateCategory(input: { categoryId: number; name?: unknown; icon?: unknown; sortOrder?: unknown; isActive?: unknown }) {
    const category = await prisma.forumCategory.findUnique({ where: { id: input.categoryId }, select: { id: true } });
    if (!category) throw new ForumError(404, "分类不存在");
    const data: Prisma.ForumCategoryUpdateInput = {};
    if (input.name !== undefined) {
      const name = text(input.name);
      if (!name || name.length > 40) throw new ForumError(400, "分类名称应为 1-40 个字符");
      data.name = name;
    }
    if (input.icon !== undefined) {
      const icon = text(input.icon);
      if (icon.length > 16) throw new ForumError(400, "分类图标不能超过 16 个字符");
      data.icon = icon || null;
    }
    if (input.sortOrder !== undefined) data.sort_order = parseIntOr(input.sortOrder, 0);
    if (input.isActive !== undefined) data.is_active = input.isActive === true || String(input.isActive).toLowerCase() === "true" || String(input.isActive) === "1";
    return prisma.forumCategory.update({ where: { id: category.id }, data });
  }

  async deactivateCategory(categoryId: number) {
    const category = await prisma.forumCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!category) throw new ForumError(404, "分类不存在");
    return prisma.forumCategory.update({ where: { id: category.id }, data: { is_active: false }, });
  }

  async listAdminComments(input: { page?: unknown; pageSize?: unknown; postId?: unknown; status?: unknown; keyword?: unknown }) {
    const page = Math.max(1, parseIntOr(input.page, 1));
    const pageSize = Math.min(100, Math.max(1, parseIntOr(input.pageSize, 20)));
    const postId = input.postId === undefined || input.postId === "" ? undefined : parsePositiveId(input.postId, "post_id");
    const statusText = text(input.status).toUpperCase();
    const status = statusText ? (Object.values(ForumCommentStatus) as string[]).includes(statusText) ? (statusText as ForumCommentStatus) : null : undefined;
    if (status === null) throw new ForumError(400, "评论状态不合法");
    const keyword = text(input.keyword).slice(0, 60);
    const where: Prisma.ForumCommentWhereInput = {
      ...(postId ? { post_id: postId } : {}),
      ...(status ? { status } : {}),
      ...(keyword ? { OR: [{ content: { contains: keyword } }, { author: { nickname: { contains: keyword } } }] } : {}),
    };
    const [total, comments] = await Promise.all([
      prisma.forumComment.count({ where }),
      prisma.forumComment.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          author: { select: { id: true, nickname: true, avatar: true } },
          post: { select: { id: true, title: true } },
          auditor: { select: { id: true, nickname: true } },
        },
      }),
    ]);
    return { page, page_size: pageSize, total, list: comments.map((comment) => ({ ...mapComment(comment), post: comment.post, auditor: comment.auditor })) };
  }

  async hideCommentByAdmin(input: { commentId: number; adminId: number }) {
    const comment = await prisma.forumComment.findUnique({ where: { id: input.commentId }, select: { id: true } });
    if (!comment) throw new ForumError(404, "评论不存在");
    const now = new Date();
    await prisma.$transaction([
      prisma.forumComment.update({ where: { id: comment.id }, data: { status: ForumCommentStatus.HIDDEN, audited_by: input.adminId, audited_at: now } }),
      prisma.adminLog.create({
        data: {
          admin_id: input.adminId,
          action: "FORUM_COMMENT_HIDE",
          target_type: "FORUM_COMMENT",
          target_id: comment.id,
          detail_json: { at: now.toISOString() } as Prisma.InputJsonValue,
        },
      }),
    ]);
  }
}

export const forumService = new ForumService();
