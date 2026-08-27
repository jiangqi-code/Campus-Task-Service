import type { RequestHandler } from "express";
import { ForumError, forumService } from "../services/forum.service";

const positiveIdFromRequest = (value: unknown, label: string) => {
  const id = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) throw new ForumError(400, `${label}不合法`);
  return id;
};

const postIdFromRequest = (req: any) => positiveIdFromRequest(req.params.postId ?? req.params.id, "信息 ID");
const commentIdFromRequest = (req: any) => positiveIdFromRequest(req.params.commentId ?? req.params.id, "评论 ID");
const categoryIdFromRequest = (req: any) => positiveIdFromRequest(req.params.categoryId ?? req.params.id, "分类 ID");

const handleForumError = (error: unknown, res: any, next: any) => {
  if (error instanceof ForumError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  next(error);
};

export const listCategories: RequestHandler = async (_req, res, next) => {
  try {
    const list = await forumService.listCategories();
    res.status(200).json({ list });
  } catch (error) {
    handleForumError(error, res, next);
  }
};

export const listPosts: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const result = await forumService.listPosts({
      viewerId: req.user.id,
      page: req.query.page,
      pageSize: req.query.pageSize ?? req.query.page_size,
      categoryId: req.query.category_id ?? req.query.categoryId,
      keyword: req.query.keyword,
      sort: req.query.sort,
      mine: req.query.mine,
    });
    res.status(200).json(result);
  } catch (error) {
    handleForumError(error, res, next);
  }
};

export const getPostDetail: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const result = await forumService.getPostDetail({
      postId: postIdFromRequest(req),
      viewerId: req.user.id,
      isAdmin: req.user.role === "ADMIN",
    });
    res.status(200).json(result);
  } catch (error) {
    handleForumError(error, res, next);
  }
};

export const createPost: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const post = await forumService.createPost({
      authorId: req.user.id,
      categoryId: body.category_id ?? body.categoryId,
      title: body.title,
      content: body.content,
      images: body.images ?? body.images_json,
      locationName: body.location_name ?? body.locationName,
      latitude: body.latitude,
      longitude: body.longitude,
    });
    res.status(201).json({ post });
  } catch (error) {
    handleForumError(error, res, next);
  }
};

export const hideOwnPost: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    await forumService.hideOwnPost({ postId: postIdFromRequest(req), authorId: req.user.id });
    res.status(200).json({ success: true });
  } catch (error) {
    handleForumError(error, res, next);
  }
};

export const likePost: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const result = await forumService.setLike({ postId: postIdFromRequest(req), userId: req.user.id, liked: req.method !== "DELETE" });
    res.status(200).json(result);
  } catch (error) {
    handleForumError(error, res, next);
  }
};

export const favoritePost: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const result = await forumService.setFavorite({ postId: postIdFromRequest(req), userId: req.user.id, favorited: req.method !== "DELETE" });
    res.status(200).json(result);
  } catch (error) {
    handleForumError(error, res, next);
  }
};

export const listFavorites: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const result = await forumService.listFavorites({
      userId: req.user.id,
      page: req.query.page,
      pageSize: req.query.pageSize ?? req.query.page_size,
    });
    res.status(200).json(result);
  } catch (error) {
    handleForumError(error, res, next);
  }
};

export const createComment: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const comment = await forumService.createComment({
      postId: postIdFromRequest(req),
      authorId: req.user.id,
      content: (req.body ?? {}).content,
    });
    res.status(201).json({ comment });
  } catch (error) {
    handleForumError(error, res, next);
  }
};

export const hideOwnComment: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    await forumService.hideOwnComment({ commentId: commentIdFromRequest(req), authorId: req.user.id });
    res.status(200).json({ success: true });
  } catch (error) {
    handleForumError(error, res, next);
  }
};

export const listAdminForumPosts: RequestHandler = async (req, res, next) => {
  try {
    const result = await forumService.listAdminPosts({
      page: req.query.page,
      pageSize: req.query.pageSize ?? req.query.page_size,
      status: req.query.status,
      categoryId: req.query.category_id ?? req.query.categoryId,
      keyword: req.query.keyword,
    });
    res.status(200).json(result);
  } catch (error) {
    handleForumError(error, res, next);
  }
};

export const auditForumPost: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const body = (req.body ?? {}) as Record<string, unknown>;
    await forumService.auditPost({
      postId: postIdFromRequest(req),
      adminId: req.user.id,
      action: body.action,
      auditNote: body.audit_note ?? body.auditNote,
      isPinned: body.is_pinned ?? body.isPinned,
    });
    res.status(200).json({ success: true });
  } catch (error) {
    handleForumError(error, res, next);
  }
};

export const listAdminForumCategories: RequestHandler = async (_req, res, next) => {
  try {
    const list = await forumService.listCategories(true);
    res.status(200).json({ list });
  } catch (error) {
    handleForumError(error, res, next);
  }
};

export const createForumCategory: RequestHandler = async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const category = await forumService.createCategory({
      code: body.code,
      name: body.name,
      icon: body.icon,
      sortOrder: body.sort_order ?? body.sortOrder,
    });
    res.status(201).json({ category });
  } catch (error) {
    handleForumError(error, res, next);
  }
};

export const updateForumCategory: RequestHandler = async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const category = await forumService.updateCategory({
      categoryId: categoryIdFromRequest(req),
      name: body.name,
      icon: body.icon,
      sortOrder: body.sort_order ?? body.sortOrder,
      isActive: body.is_active ?? body.isActive,
    });
    res.status(200).json({ category });
  } catch (error) {
    handleForumError(error, res, next);
  }
};

export const deactivateForumCategory: RequestHandler = async (req, res, next) => {
  try {
    const category = await forumService.deactivateCategory(categoryIdFromRequest(req));
    res.status(200).json({ category });
  } catch (error) {
    handleForumError(error, res, next);
  }
};

export const listAdminForumComments: RequestHandler = async (req, res, next) => {
  try {
    const result = await forumService.listAdminComments({
      page: req.query.page,
      pageSize: req.query.pageSize ?? req.query.page_size,
      postId: req.query.post_id ?? req.query.postId,
      status: req.query.status,
      keyword: req.query.keyword,
    });
    res.status(200).json(result);
  } catch (error) {
    handleForumError(error, res, next);
  }
};

export const hideForumCommentByAdmin: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    await forumService.hideCommentByAdmin({ commentId: commentIdFromRequest(req), adminId: req.user.id });
    res.status(200).json({ success: true });
  } catch (error) {
    handleForumError(error, res, next);
  }
};
